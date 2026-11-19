import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gitRun } from "#git/git.js";
import { trustedCageGit } from "./cage-host-git.js";
import { errorMessage, GantryUserError } from "#core/user-error.js";
import { resolveCageChanges, restoreFile, restoreSymlink, type CageResolvedChange } from "./cage-revert.js";
import { withCageWriteParent } from "./cage-write-path.js";
import { buildCagePlan } from "./cage-rules.js";
import { listCageScopeTree } from "./cage-scope.js";
import {
  addCageScopeEntries,
  diffCageSnapshots,
  takeCageSnapshot,
  type CageEntry,
  type CageSnapshot,
  type CageSnapshotOptions,
} from "./cage-snapshot.js";

/**
 * On-disk baseline journal so a cage session killed with an uncatchable signal (`kill -9` on the wrapper)
 * leaves no protected tamper behind: the next cage invocation in the same root finds the dirty journal,
 * confirms the previous wrapper is dead, kills the descendants it recorded, restores every protected path
 * to the hash-verified baseline bytes and clears the journal before it spawns anything (MSN-0253).
 *
 * Layout (all writes are tmp + rename):
 *   journal.json    baseline entries, wrapper pid + start time, overrides, lock_deps   journal.sha256  sha256 of journal.json
 *   pids.json       wrapper child + descendants, refreshed while it runs      pids.sha256     sha256 of pids.json
 *   blobs/<sha256>  baseline bytes of revert-mode files that fit the snapshot caps
 * With a cage scope, out-of-scope files are not listed one by one: the journal records the scope tree (already in
 * the repository object store) and the `--allow-only` globs, and recovery rebuilds those entries from the tree.
 * A hash mismatch anywhere is a corrupt journal: cage refuses to start (`GXT_CAGE_JOURNAL_CORRUPT`, exit 2).
 */
export const CAGE_JOURNAL_DIR = "gantry-cage-journal";
export const CAGE_JOURNAL_VERSION = 1;
/** Floor for the pid refresh cadence: each refresh is one `ps` listing, which must not crowd the watcher. */
export const CAGE_JOURNAL_PID_REFRESH_MIN_MS = 500;

const MANIFEST_FILE = "journal.json";
const PIDS_FILE = "pids.json";
const BLOBS_DIR = "blobs";

interface JournalEntry {
  abs: string;
  rel: string;
  rule: CageEntry["rule"];
  mode: CageEntry["mode"];
  overridden: boolean;
  type: CageEntry["type"];
  sha256: string;
  size: number;
  fileMode: number;
  linkTarget: string | null;
  /** Baseline bytes are stored under blobs/<sha256>; false for detect-only entries. */
  blob: boolean;
  /** Git blob id of an out-of-scope entry (cage scope); absent otherwise. */
  git_oid?: string;
}

interface JournalManifest {
  version: number;
  root: string;
  wrapper: TrackedPid;
  started_at: string;
  overrides: string[];
  /** `--lock-deps` for this session; absent in journals written before MSN-0275 (false). */
  lock_deps?: boolean;
  /** `--allow-only` globs for this session; absent without a flag scope (MSN-0276). */
  allow_only?: string[];
  /** The scope tree out-of-scope entries are restored from; absent without a scope (MSN-0276). */
  scope_tree?: string;
  /** Paths present at startup whose deletion the operator accepted. */
  scope_deleted?: string[];
  entries: JournalEntry[];
}

/** A pid plus its start time so a reused pid is never mistaken for the old process. */
interface TrackedPid {
  pid: number;
  start: string | null;
}

export interface CageJournalHandle {
  dir: string;
  /** Record the caged command and its current descendants: at spawn, then every refresh interval (see cage-run.ts). */
  refreshPids(childPid: number | null): void;
  /** `gantry cage watch` accepted a change: persist the new baseline so a kill -9 restores to it (MSN-0268). */
  replaceBaseline(baseline: CageSnapshot): void;
  /** Clean shutdown: the session restored everything it had to, so the journal is no longer needed. */
  dispose(): void;
}

export interface CageRecovery {
  journalDir: string;
  previousPid: number;
  startedAt: string;
  restored: CageResolvedChange[];
  orphansKilled: number[];
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function writeAtomic(file: string, data: Buffer | string, mode = 0o600): void {
  const tmp = `${file}.${String(process.pid)}-${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, data, { mode });
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/** Write `<name>` and its `<name minus .json>.sha256` sidecar. */
function writeHashed(dir: string, name: string, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  writeAtomic(path.join(dir, name), body);
  writeAtomic(path.join(dir, name.replace(/\.json$/, ".sha256")), `${sha256Hex(body)}\n`);
}

function corrupt(dir: string, detail: string): GantryUserError {
  return new GantryUserError(
    "GXT_CAGE_JOURNAL_CORRUPT",
    `cage: journal at ${dir} is corrupt (${detail}); refusing to start the command (fail closed)`,
    "Inspect the journal, restore protected files by hand if needed, then remove the directory to continue.",
    2,
  );
}

/** Read `<name>` only if its sidecar hash matches; null when the file is absent. */
function readHashed<T>(dir: string, name: string): T | null {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) return null;
  const body = fs.readFileSync(file);
  let expected: string;
  try {
    expected = fs.readFileSync(path.join(dir, name.replace(/\.json$/, ".sha256")), "utf8").trim();
  } catch {
    throw corrupt(dir, `${name} has no hash sidecar`);
  }
  if (expected !== sha256Hex(body)) throw corrupt(dir, `${name} does not match its sha256`);
  try {
    return JSON.parse(body.toString("utf8")) as T;
  } catch {
    throw corrupt(dir, `${name} is not valid JSON`);
  }
}

/** `ps` start time per pid (POSIX); empty on Windows or when `ps` is unavailable. */
function processStarts(pids: readonly number[]): Map<number, string> {
  const out = new Map<number, string>();
  if (process.platform === "win32" || pids.length === 0) return out;
  const r = spawnSync("ps", ["-o", "pid=,lstart=", "-p", pids.join(",")], { encoding: "utf8" });
  if (r.status !== 0) return out;
  for (const line of r.stdout.split("\n")) {
    const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    if (m) out.set(Number(m[1]), m[2]!);
  }
  return out;
}

function trackPids(pids: readonly number[]): TrackedPid[] {
  const starts = processStarts(pids);
  return pids.map((pid) => ({ pid, start: starts.get(pid) ?? null }));
}

/** The command and its descendants with start times from one `ps` listing (POSIX); the command alone elsewhere. */
function trackTree(childPid: number): TrackedPid[] {
  if (process.platform === "win32") return [{ pid: childPid, start: null }];
  const r = spawnSync("ps", ["-A", "-o", "pid=,ppid=,lstart="], { encoding: "utf8" });
  if (r.status !== 0) return [{ pid: childPid, start: null }];
  const children = new Map<number, number[]>();
  const start = new Map<number, string>();
  for (const line of r.stdout.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    const parent = Number(m[2]);
    start.set(pid, m[3]!);
    children.set(parent, [...(children.get(parent) ?? []), pid]);
  }
  const out: TrackedPid[] = [{ pid: childPid, start: start.get(childPid) ?? null }];
  const queue = [childPid];
  while (queue.length > 0) {
    for (const c of children.get(queue.shift()!) ?? []) {
      out.push({ pid: c, start: start.get(c) ?? null });
      queue.push(c);
    }
  }
  return out;
}

/** Alive, and still the process we recorded (start time unchanged when one is known). */
function isTrackedAlive(t: TrackedPid): boolean {
  try {
    process.kill(t.pid, 0);
  } catch {
    return false;
  }
  if (t.start === null) return true;
  return processStarts([t.pid]).get(t.pid) === t.start;
}

/** Host-managed sessions keep the journal alongside their protected scope objects. */
export function resolveCageJournalDir(root: string): string {
  const host = trustedCageGit(root);
  if (host) return path.join(host.stateDir, CAGE_JOURNAL_DIR);
  const r = gitRun(root, ["rev-parse", "--path-format=absolute", "--git-dir"]);
  const gitDir = r.ok ? r.stdout.trim() : "";
  if (gitDir) return path.join(path.resolve(gitDir), CAGE_JOURNAL_DIR);
  return path.join(os.tmpdir(), CAGE_JOURNAL_DIR, sha256Hex(path.resolve(root)).slice(0, 16));
}

function toJournalEntry(e: CageEntry): JournalEntry {
  return {
    abs: e.abs,
    rel: e.rel,
    rule: e.rule,
    mode: e.mode,
    overridden: e.overridden,
    type: e.type,
    sha256: e.sha256,
    size: e.size,
    fileMode: e.fileMode,
    linkTarget: e.linkTarget,
    blob: e.bytes !== null,
    ...(e.git ? { git_oid: e.git.oid } : {}),
  };
}

/** Persist the baseline before the command spawns. Blobs are written first so the manifest never names a missing one. */
export function writeCageJournal(
  dir: string,
  root: string,
  baseline: CageSnapshot,
  overrides: readonly string[],
  opts: { lockDeps?: boolean; allowOnly?: readonly string[] } = {},
): CageJournalHandle {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, BLOBS_DIR), { recursive: true, mode: 0o700 });
  const [wrapper] = trackPids([process.pid]);
  const originalPaths = baseline.scopeTree ? [...baseline.entries.keys()] : [];
  const manifest: JournalManifest = {
    version: CAGE_JOURNAL_VERSION,
    root: path.resolve(root),
    wrapper: wrapper!,
    started_at: new Date().toISOString(),
    overrides: [...overrides],
    lock_deps: opts.lockDeps === true,
    ...(opts.allowOnly && opts.allowOnly.length > 0 ? { allow_only: [...opts.allowOnly] } : {}),
    ...(baseline.scopeTree ? { scope_tree: baseline.scopeTree } : {}),
    entries: journalEntries(dir, baseline),
  };
  writeHashed(dir, MANIFEST_FILE, manifest);
  writeHashed(dir, PIDS_FILE, { pids: [] as TrackedPid[] });
  return {
    dir,
    refreshPids(childPid) {
      if (!childPid) return;
      try {
        writeHashed(dir, PIDS_FILE, { pids: trackTree(childPid) });
      } catch {
        // The journal dir may already be gone at shutdown; the next tick or dispose settles it.
      }
    },
    replaceBaseline(next) {
      const deleted = originalPaths.filter((abs) => !next.entries.has(abs)).map((abs) => path.relative(root, abs));
      writeHashed(dir, MANIFEST_FILE, { ...manifest, scope_deleted: deleted, entries: journalEntries(dir, next) });
    },
    dispose() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Write every baseline blob not yet in the journal (blobs first, so a manifest never names a missing one). */
function journalEntries(dir: string, baseline: CageSnapshot): JournalEntry[] {
  const entries: JournalEntry[] = [];
  for (const e of baseline.entries.values()) {
    // Unchanged scope entries live in the original tree. An accepted symlink has a captured target.
    if (e.git && !e.bytes && e.linkTarget === null) continue;
    const blob = path.join(dir, BLOBS_DIR, e.sha256);
    if (e.bytes && !fs.existsSync(blob)) writeAtomic(blob, e.bytes);
    entries.push(toJournalEntry(e));
  }
  return entries;
}

function readManifest(dir: string, root: string): JournalManifest | null {
  const m = readHashed<JournalManifest>(dir, MANIFEST_FILE);
  if (!m) return null;
  if (m.version !== CAGE_JOURNAL_VERSION || typeof m.wrapper?.pid !== "number" || !Array.isArray(m.entries)) {
    throw corrupt(dir, "unsupported or malformed manifest");
  }
  if (m.root !== path.resolve(root)) throw corrupt(dir, `journal root ${m.root} is not this root`);
  return m;
}

/** Load blob bytes for every entry that has one, verifying each against its recorded hash before any restore. */
function loadBaseline(dir: string, m: JournalManifest): CageSnapshot {
  const entries = new Map<string, CageEntry>();
  for (const e of m.entries) {
    let bytes: Buffer | null = null;
    if (e.blob) {
      const blobPath = path.join(dir, BLOBS_DIR, e.sha256);
      if (!fs.existsSync(blobPath)) throw corrupt(dir, `blob ${e.sha256} for ${e.rel} is missing`);
      bytes = fs.readFileSync(blobPath);
      if (sha256Hex(bytes) !== e.sha256) throw corrupt(dir, `blob for ${e.rel} does not match its sha256`);
    }
    const { blob: _blob, git_oid: oid, ...rest } = e;
    entries.set(e.abs, { ...rest, bytes, ...(oid ? { git: { root: m.root, oid } } : {}) });
  }
  return { entries, scopeTree: m.scope_tree ?? null };
}

function killOrphans(dir: string): number[] {
  const pids = readHashed<{ pids: TrackedPid[] }>(dir, PIDS_FILE)?.pids ?? [];
  if (process.platform === "win32") return [];
  const killed: number[] = [];
  // Descendants are listed after the child by refreshPids; kill deepest first so nothing respawns.
  for (const t of [...pids].reverse()) {
    if (!isTrackedAlive(t)) continue;
    try {
      process.kill(t.pid, "SIGKILL");
      killed.push(t.pid);
    } catch {
      // gone between the check and the kill
    }
  }
  return killed;
}

function recoveryFailed(dir: string, detail: string): GantryUserError {
  return new GantryUserError(
    "GXT_CAGE_RECOVERY_FAILED",
    `cage: could not restore the interrupted session (${detail}). Recovery journal retained at ${dir}.`,
    "Resolve the filesystem error and retry recovery.",
    2,
  );
}

/** Reestablish the recorded config before any code opens its working-tree path. */
function restoreJournalConfig(root: string, dir: string, baseline: CageSnapshot): void {
  const file = path.join(root, ".cage.yaml");
  const config = baseline.entries.get(file);
  try {
    withCageWriteParent(file, false, (target) => {
      if (!config) fs.rmSync(target, { force: true });
      else if (config.type === "symlink" && config.linkTarget !== null) restoreSymlink(target, config.linkTarget);
      else if (config.bytes) restoreFile(target, config, config.bytes);
      else throw corrupt(dir, "missing baseline for .cage.yaml");
    });
  } catch (err) {
    if (err instanceof GantryUserError) throw err;
    throw recoveryFailed(dir, `.cage.yaml: ${errorMessage(err)}`);
  }
}

/**
 * Recover from a journal left by a session that did not shut down. Returns null when there is no journal.
 * Fails closed (exit 2) when the journal is corrupt or the previous wrapper is still running.
 */
export function recoverCageJournal(root: string, dir: string, snap: CageSnapshotOptions): CageRecovery | null {
  const m = readManifest(dir, root);
  if (!m) return null;
  if (isTrackedAlive(m.wrapper)) {
    throw new GantryUserError(
      "GXT_CAGE_SESSION_ACTIVE",
      `cage: another cage session (pid ${String(m.wrapper.pid)}, started ${m.started_at}) is still running in ${root}; refusing to start a second one`,
      "Finish or stop the other session first.",
      2,
    );
  }
  const baseline = loadBaseline(dir, m);
  const orphansKilled = killOrphans(dir);
  restoreJournalConfig(root, dir, baseline);
  const plan = buildCagePlan(root, { overrides: m.overrides, lockDeps: m.lock_deps === true, allowOnly: m.allow_only });
  if (m.scope_tree && plan.scope) addCageScopeEntries(plan, baseline.entries, listCageScopeTree(root, m.scope_tree));
  for (const rel of m.scope_deleted ?? []) baseline.entries.delete(path.join(root, rel));
  const current = takeCageSnapshot(plan, { ...snap, keepBytes: false, scopeBaselineTree: m.scope_tree });
  const restored = resolveCageChanges(diffCageSnapshots(baseline, current), { reportOnly: false });
  const failed = restored.filter((change) => change.outcome === "revert_failed" || change.outcome === "detect_only");
  if (failed.length) throw recoveryFailed(dir, failed.map((change) => `${change.rel}: ${change.errorCode ?? change.outcome}`).join(", "));
  fs.rmSync(dir, { recursive: true, force: true });
  return { journalDir: dir, previousPid: m.wrapper.pid, startedAt: m.started_at, restored, orphansKilled };
}
