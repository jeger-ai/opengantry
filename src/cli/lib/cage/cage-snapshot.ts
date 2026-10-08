import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { toPosixRel } from "../cli-io.js";
import {
  CAGE_RULE_MODES,
  CAGE_SCAN_SKIP_DIRS,
  cageBasenameRule,
  type CagePlan,
  type CageRuleId,
  type CageRuleMode,
} from "./cage-rules.js";

export interface CageEntry {
  abs: string;
  /** POSIX path relative to the cage root (may start with `../` for a linked worktree git dir). */
  rel: string;
  rule: CageRuleId;
  mode: CageRuleMode;
  type: "file" | "symlink";
  sha256: string;
  size: number;
  fileMode: number;
  /** Baseline bytes for revert; null when over the size cap, budget, or report-only. */
  bytes: Buffer | null;
  linkTarget: string | null;
}

export interface CageSnapshot {
  entries: Map<string, CageEntry>;
}

export interface CageSnapshotOptions {
  /** Keep file bytes in memory so the snapshot can restore them. */
  keepBytes: boolean;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export interface CageChange {
  abs: string;
  rel: string;
  kind: "added" | "modified" | "deleted";
  rule: CageRuleId;
  mode: CageRuleMode;
  before: CageEntry | null;
  after: CageEntry | null;
}

interface CaptureContext {
  root: string;
  opts: CageSnapshotOptions;
  budget: number;
  entries: Map<string, CageEntry>;
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

function readEntry(abs: string, rule: CageRuleId, ctx: CaptureContext): CageEntry | null {
  const st = fs.lstatSync(abs);
  const mode = CAGE_RULE_MODES[rule];
  const base = { abs, rel: toPosixRel(ctx.root, abs), rule, mode, fileMode: st.mode & 0o7777 };
  if (st.isSymbolicLink()) {
    const target = fs.readlinkSync(abs);
    return { ...base, type: "symlink", sha256: sha256Hex(`symlink\0${target}`), size: 0, bytes: null, linkTarget: target };
  }
  if (!st.isFile()) return null;
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

function captureEntry(abs: string, rule: CageRuleId, ctx: CaptureContext): void {
  const existing = ctx.entries.get(abs);
  // A path matched by several rules keeps the strictest one (revert beats report).
  if (existing && (existing.mode === "revert" || CAGE_RULE_MODES[rule] === "report")) return;
  try {
    const entry = readEntry(abs, rule, ctx);
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

function captureTarget(abs: string, rule: CageRuleId, ctx: CaptureContext): void {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(abs);
  } catch {
    return;
  }
  if (st.isDirectory()) {
    walkTree(abs, null, (child) => captureEntry(child, rule, ctx));
    return;
  }
  captureEntry(abs, rule, ctx);
}

export function takeCageSnapshot(plan: CagePlan, opts: CageSnapshotOptions): CageSnapshot {
  const ctx: CaptureContext = { root: plan.root, opts, budget: opts.maxTotalBytes, entries: new Map() };
  for (const target of plan.targets) captureTarget(target.abs, target.rule, ctx);
  walkTree(plan.root, CAGE_SCAN_SKIP_DIRS, (abs) => {
    const rule = cageBasenameRule(path.basename(abs));
    if (rule) captureEntry(abs, rule, ctx);
  });
  return { entries: ctx.entries };
}

function entryChanged(a: CageEntry, b: CageEntry): boolean {
  // mtime is ignored on purpose: a bare `touch` is not a mutation.
  return a.sha256 !== b.sha256 || a.type !== b.type || a.fileMode !== b.fileMode;
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
    changes.push({ abs, rel: ref.rel, kind, rule: ref.rule, mode: ref.mode, before: b, after: a });
  }
  return changes.sort((x, y) => x.rel.localeCompare(y.rel));
}
