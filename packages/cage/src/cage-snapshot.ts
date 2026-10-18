import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { toPosixRel } from "#core/posix-path.js";
import { GantryUserError } from "#core/user-error.js";
import {
  CAGE_SCAN_SKIP_DIRS,
  applyCageOverride,
  cagePlanRuleMode,
  cageScanRule,
  cageScopeHit,
  inCageScope,
  type CagePlan,
  type CageRuleId,
  type CageRuleMode,
} from "./cage-rules.js";
import {
  assertCageScopeGitRoot,
  captureCageScopeTree,
  createCageScopeIndex,
  disposeCageScopeIndex,
  readCageScopeBlob,
  type CageScopeFile,
} from "./cage-scope.js";

/** Baseline caps so an oversized or hostile protected set cannot stall the session. */
export const CAGE_MAX_TARGETS = 5000;
export const CAGE_MAX_SCAN_BYTES = 64 * 1024 * 1024;

export interface CageEntry {
  abs: string;
  /** POSIX path relative to the cage root (may start with `../` for a linked worktree git dir). */
  rel: string;
  rule: CageRuleId;
  mode: CageRuleMode;
  /** A revert rule downgraded to report by `--allow-override`. */
  overridden: boolean;
  type: "file" | "symlink";
  sha256: string;
  size: number;
  fileMode: number;
  /** Baseline bytes for revert; null for report-mode entries and for hash-only snapshots (`keepBytes: false`). */
  bytes: Buffer | null;
  linkTarget: string | null;
  /**
   * Out-of-scope entries (cage scope): the git blob holding the baseline, read back on restore. Such entries
   * compare by blob id; `sha256` is filled in only for changed ones (empty until then).
   */
  git?: { root: string; oid: string };
}

export interface CageSnapshot {
  entries: Map<string, CageEntry>;
  /** The scope tree the out-of-scope entries came from; null without a scope. */
  scopeTree: string | null;
}

export interface CageSnapshotOptions {
  /** Keep file bytes in memory so the snapshot can restore them. */
  keepBytes: boolean;
  maxFileBytes: number;
  maxTotalBytes: number;
  /** Baseline only: abort when the protected set exceeds these caps (counts are reported). */
  limits?: { maxTargets: number; maxScanBytes: number };
  /** Temporary index for the scope tree, kept for the session so each snapshot only hashes what changed. */
  scopeIndex?: string;
}

export interface CageChange {
  abs: string;
  rel: string;
  kind: "added" | "modified" | "deleted";
  rule: CageRuleId;
  mode: CageRuleMode;
  overridden: boolean;
  before: CageEntry | null;
  after: CageEntry | null;
}

interface CaptureContext {
  plan: CagePlan;
  opts: CageSnapshotOptions;
  budget: number;
  entries: Map<string, CageEntry>;
  /** Files and bytes in the protected set, counted against `opts.limits`. */
  scanned: { files: number; bytes: number; over: boolean; seen: Set<string> };
  /**
   * Baseline only (`keepBytes`): revert-rule files the snapshot could not hold. A file over the per-file
   * cap, or a set over the total budget, fails closed after the scan so the error can list everything.
   */
  caps: { tooLarge: { rel: string; size: number }[]; wantedBytes: number };
}

const HASH_CHUNK_BYTES = 1024 * 1024;

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** Streamed hash so files over the in-memory cap are still change-detected. */
function hashFileChunked(abs: string): string {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(abs, "r");
  try {
    const buf = Buffer.alloc(HASH_CHUNK_BYTES);
    let n: number;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

/** Past a cap, keep counting sizes (lstat only, no hashing) so the error can state the full totals. */
function countScan(abs: string, st: fs.Stats, ctx: CaptureContext): boolean {
  const limits = ctx.opts.limits;
  if (!limits || ctx.scanned.seen.has(abs)) return ctx.scanned.over;
  ctx.scanned.seen.add(abs);
  ctx.scanned.files += 1;
  ctx.scanned.bytes += st.isFile() ? st.size : 0;
  if (ctx.scanned.files > limits.maxTargets || ctx.scanned.bytes > limits.maxScanBytes) ctx.scanned.over = true;
  return ctx.scanned.over;
}

function readEntry(abs: string, rule: CageRuleId, ruleMode: CageRuleMode, ctx: CaptureContext): CageEntry | null {
  const st = fs.lstatSync(abs);
  if (countScan(abs, st, ctx)) return null;
  const rel = toPosixRel(ctx.plan.root, abs);
  // Outside a scope, a report-mode path (an unfrozen lockfile) is restored like everything else there.
  const scoped = cageScopeHit(ctx.plan, rel, { rule, mode: ruleMode, overridden: false })!;
  const resolved = applyCageOverride(ctx.plan, rel, scoped)!;
  const mode = resolved.mode;
  const base = { abs, rel, rule: resolved.rule, mode, overridden: resolved.overridden, fileMode: st.mode & 0o7777 };
  if (st.isSymbolicLink()) {
    const target = fs.readlinkSync(abs);
    return { ...base, type: "symlink", sha256: sha256Hex(`symlink\0${target}`), size: 0, bytes: null, linkTarget: target };
  }
  if (!st.isFile()) return null;
  if (ctx.opts.keepBytes && mode === "revert") {
    if (st.size > ctx.opts.maxFileBytes) ctx.caps.tooLarge.push({ rel, size: st.size });
    ctx.caps.wantedBytes += st.size;
  }
  const keep =
    ctx.opts.keepBytes && mode === "revert" && st.size <= ctx.opts.maxFileBytes && st.size <= ctx.budget;
  if (!keep) {
    return { ...base, type: "file", sha256: hashFileChunked(abs), size: st.size, bytes: null, linkTarget: null };
  }
  // One read for hash and bytes, so the restored content is exactly what was hashed.
  const bytes = fs.readFileSync(abs);
  ctx.budget -= bytes.length;
  return { ...base, type: "file", sha256: sha256Hex(bytes), size: bytes.length, bytes, linkTarget: null };
}

function captureEntry(abs: string, rule: CageRuleId, mode: CageRuleMode, ctx: CaptureContext): void {
  const existing = ctx.entries.get(abs);
  // A path matched by several rules keeps the strictest one (revert beats report).
  if (existing && (existing.mode === "revert" || existing.overridden || mode === "report")) return;
  try {
    const entry = readEntry(abs, rule, mode, ctx);
    if (entry) ctx.entries.set(abs, entry);
  } catch {
    // Vanished or unreadable between listing and reading: not part of this snapshot.
  }
}

/** Visit files and symlinks under `absDir` without following directory symlinks. */
function walkTree(absDir: string, skipDirs: ReadonlySet<string> | null, visit: (abs: string) => void): void {
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const d of dirents) {
    const child = path.join(absDir, d.name);
    if (d.isDirectory()) {
      if (!skipDirs?.has(d.name)) walkTree(child, skipDirs, visit);
      continue;
    }
    if (d.isFile() || d.isSymbolicLink()) visit(child);
  }
}

function captureTarget(abs: string, rule: CageRuleId, mode: CageRuleMode, ctx: CaptureContext): void {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(abs);
  } catch {
    return;
  }
  if (st.isDirectory()) {
    walkTree(abs, null, (child) => captureEntry(child, rule, mode, ctx));
    return;
  }
  captureEntry(abs, rule, mode, ctx);
}

/** Whole-tree scan: built-in basename rules (`.env*`, lockfiles, frozen manifests) and `.cage.yaml` globs. */
function captureScanned(abs: string, ctx: CaptureContext): void {
  const rel = toPosixRel(ctx.plan.root, abs);
  const rule = cageScanRule(rel, ctx.plan.dependencies);
  if (rule) captureEntry(abs, rule, cagePlanRuleMode(ctx.plan, rule), ctx);
  if (ctx.plan.globs.length === 0) return;
  for (const g of ctx.plan.globs) {
    if (g.re.test(rel)) captureEntry(abs, "cage_protect", g.mode, ctx);
  }
}

function limitsError(ctx: CaptureContext): GantryUserError {
  const l = ctx.opts.limits!;
  const mib = (n: number): string => (n / (1024 * 1024)).toFixed(1);
  return new GantryUserError(
    "GXT_CAGE_LIMITS_EXCEEDED",
    `cage: protected set too large: ${String(ctx.scanned.files)} file(s), ${mib(ctx.scanned.bytes)} MiB (limits ${String(l.maxTargets)} files, ${mib(l.maxScanBytes)} MiB); the command was not run`,
    "Narrow broad .cage.yaml or manifest forbidden_zones entries.",
    2,
  );
}

function fileTooLargeError(ctx: CaptureContext): GantryUserError {
  const list = ctx.caps.tooLarge
    .sort((a, b) => a.rel.localeCompare(b.rel))
    .map((f) => `${f.rel} (${String(f.size)} bytes)`)
    .join(", ");
  return new GantryUserError(
    "GXT_CAGE_FILE_TOO_LARGE",
    `cage: ${String(ctx.caps.tooLarge.length)} protected file(s) exceed the ${String(ctx.opts.maxFileBytes)}-byte per-file snapshot cap and could not be restored: ${list}; the command was not run`,
    "Raise --max-file-bytes, or pass --allow-override <path> to report that path instead of restoring it (announced in every report).",
    2,
  );
}

function budgetError(ctx: CaptureContext): GantryUserError {
  return new GantryUserError(
    "GXT_CAGE_SNAPSHOT_BUDGET_EXCEEDED",
    `cage: protected files total ${String(ctx.caps.wantedBytes)} bytes, over the ${String(ctx.opts.maxTotalBytes)}-byte in-memory snapshot budget; the command was not run`,
    "Narrow broad .cage.yaml or manifest forbidden_zones entries, or pass --allow-override <path> for paths that may be reported instead of restored.",
    2,
  );
}

/**
 * Capture the protected set. With `keepBytes` (the baseline) every revert-rule file must fit the per-file
 * cap and the total budget, or the snapshot could not restore it: cage then fails closed before the
 * command runs (exit 2), the same shape as the scan caps (ADR-0048 decision 2, amended by MSN-0254).
 * Later snapshots (`keepBytes: false`) only hash, so caps never apply to them.
 */
/**
 * Add an `out_of_scope` entry for every file of a scope tree that lies outside the scope and that no other rule
 * already holds. No bytes: the blob in the object store is the baseline.
 */
export function addCageScopeEntries(plan: CagePlan, entries: Map<string, CageEntry>, files: readonly CageScopeFile[]): void {
  for (const f of files) {
    const abs = path.join(plan.root, ...f.rel.split("/"));
    if (entries.has(abs) || inCageScope(plan, f.rel)) continue;
    const resolved = applyCageOverride(plan, f.rel, { rule: "out_of_scope", mode: "revert", overridden: false })!;
    entries.set(abs, {
      abs,
      rel: f.rel,
      rule: "out_of_scope",
      mode: resolved.mode,
      overridden: resolved.overridden,
      type: f.type,
      sha256: "",
      size: 0,
      fileMode: f.fileMode,
      bytes: null,
      linkTarget: null,
      git: { root: plan.root, oid: f.oid },
    });
  }
}

function captureScope(plan: CagePlan, opts: CageSnapshotOptions, entries: Map<string, CageEntry>): string {
  if (opts.keepBytes) assertCageScopeGitRoot(plan.root);
  const index = opts.scopeIndex ?? createCageScopeIndex(plan.root);
  try {
    const { tree, files } = captureCageScopeTree(plan.root, index);
    addCageScopeEntries(plan, entries, files);
    return tree;
  } finally {
    if (!opts.scopeIndex) disposeCageScopeIndex(index);
  }
}

export function takeCageSnapshot(plan: CagePlan, opts: CageSnapshotOptions): CageSnapshot {
  const ctx: CaptureContext = {
    plan,
    opts,
    budget: opts.maxTotalBytes,
    entries: new Map(),
    scanned: { files: 0, bytes: 0, over: false, seen: new Set() },
    caps: { tooLarge: [], wantedBytes: 0 },
  };
  for (const target of plan.targets) captureTarget(target.abs, target.rule, target.mode, ctx);
  walkTree(plan.root, CAGE_SCAN_SKIP_DIRS, (abs) => captureScanned(abs, ctx));
  if (ctx.scanned.over) throw limitsError(ctx);
  if (ctx.opts.keepBytes) {
    if (ctx.caps.tooLarge.length > 0) throw fileTooLargeError(ctx);
    if (ctx.caps.wantedBytes > ctx.opts.maxTotalBytes) throw budgetError(ctx);
  }
  // Last, so rule-held paths keep their in-memory entry; the scope covers everything else git would track.
  const scopeTree = plan.scope ? captureScope(plan, opts, ctx.entries) : null;
  return { entries: ctx.entries, scopeTree };
}

function entryChanged(a: CageEntry, b: CageEntry): boolean {
  // mtime is ignored on purpose: a bare `touch` is not a mutation.
  const content = a.git && b.git ? a.git.oid !== b.git.oid : a.sha256 !== b.sha256;
  return content || a.type !== b.type || a.fileMode !== b.fileMode;
}

/** Fill in sha256 (and a symlink's target) for an out-of-scope entry, from its blob or, after, from disk. */
function hydrate(e: CageEntry | null, side: "before" | "after"): CageEntry | null {
  if (!e?.git || e.sha256) return e;
  try {
    if (side === "after") {
      if (e.type === "symlink") {
        const target = fs.readlinkSync(e.abs);
        return { ...e, sha256: sha256Hex(`symlink\0${target}`), linkTarget: target };
      }
      const bytes = fs.readFileSync(e.abs);
      return { ...e, sha256: sha256Hex(bytes), size: bytes.length };
    }
    const blob = readCageScopeBlob(e.git.root, e.rel, e.git.oid);
    if (e.type === "symlink") {
      const target = blob.toString("utf8");
      return { ...e, sha256: sha256Hex(`symlink\0${target}`), linkTarget: target };
    }
    return { ...e, sha256: sha256Hex(blob), size: blob.length };
  } catch {
    // Gone or unreadable between snapshot and diff: the change is still reported, without a digest.
    return e;
  }
}

export function diffCageSnapshots(before: CageSnapshot, after: CageSnapshot): CageChange[] {
  const keys = new Set([...before.entries.keys(), ...after.entries.keys()]);
  const changes: CageChange[] = [];
  for (const abs of keys) {
    const b = before.entries.get(abs) ?? null;
    const a = after.entries.get(abs) ?? null;
    let kind: CageChange["kind"] | null = null;
    if (b && !a) kind = "deleted";
    else if (!b && a) kind = "added";
    else if (b && a && entryChanged(b, a)) kind = "modified";
    if (!kind) continue;
    const ref = (b ?? a)!;
    changes.push({
      abs,
      rel: ref.rel,
      kind,
      rule: ref.rule,
      mode: ref.mode,
      overridden: ref.overridden,
      before: hydrate(b, "before"),
      after: hydrate(a, "after"),
    });
  }
  return changes.sort((x, y) => x.rel.localeCompare(y.rel));
}
