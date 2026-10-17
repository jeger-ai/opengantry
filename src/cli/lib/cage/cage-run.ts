import fs from "node:fs";
import path from "node:path";
import { getRepoRoot } from "../git/git.js";
import {
  CAGE_JOURNAL_PID_REFRESH_MIN_MS,
  recoverCageJournal,
  resolveCageJournalDir,
  writeCageJournal,
  type CageJournalHandle,
  type CageRecovery,
} from "./cage-journal.js";
import { buildCageReport, type CageReport } from "./cage-report.js";
import { resolveCageChanges, type CageResolvedChange } from "./cage-revert.js";
import { buildCagePlan, canonicalCageRoot, type CageScope } from "./cage-rules.js";
import { assertCageScopeGitRoot, createCageScopeIndex, disposeCageScopeIndex } from "./cage-scope.js";
import {
  CAGE_MAX_SCAN_BYTES,
  CAGE_MAX_TARGETS,
  diffCageSnapshots,
  takeCageSnapshot,
  type CageSnapshot,
  type CageSnapshotOptions,
} from "./cage-snapshot.js";
import { signalExitCode, startCaged, type CageProcessResult } from "./cage-process.js";
import { createCagePushGuard } from "./cage-push-guard.js";
import { CAGE_SESSION_ENV } from "./cage-suggest.js";
import {
  CAGE_CONTEST_LIMIT,
  CAGE_DEFAULT_WATCH_INTERVAL_MS,
  openCageSessionLog,
  startCageWatch,
  type CageSessionLog,
  type CageWatchSummary,
} from "./cage-watch.js";

/** Per-file in-memory snapshot cap; a larger revert-rule file at baseline refuses to start (`GXT_CAGE_FILE_TOO_LARGE`). */
export const CAGE_DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Total in-memory snapshot budget across all revert-rule files; over it, cage refuses to start (`GXT_CAGE_SNAPSHOT_BUDGET_EXCEEDED`). */
export const CAGE_DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
/** Time between SIGTERM and SIGKILL when the contested-file halt terminates the command. */
export const CAGE_DEFAULT_HALT_GRACE_MS = 2000;

export interface CageRunOptions {
  command: readonly string[];
  /** Working directory for the command; the cage root is its git top-level, else this dir. */
  cwd?: string;
  reportOnly?: boolean;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  /** Live restore while the command runs (default true). */
  watch?: boolean;
  watchIntervalMs?: number;
  /** Session pre-push guard for git run by the caged command (default true inside a git work tree). */
  pushGuard?: boolean;
  /** Root-relative paths whose revert rules are downgraded to report for this run (`--allow-override`). */
  allowOverride?: readonly string[];
  /**
   * Live restores of one path before cage halts the command (`--contest-limit`). Overrides `.cage.yaml`
   * `contest_limit:`; default {@link CAGE_CONTEST_LIMIT}. 0 never halts: the path is contested after the
   * default limit and restored once at exit.
   */
  contestLimit?: number;
  /** `--lock-deps`: freeze lockfiles and dependency manifests for this run whatever `.cage.yaml` says. */
  lockDeps?: boolean;
  /** `--allow-only <glob>`: protect everything git would track outside these globs (with `.cage.yaml` `allow_only:`). */
  allowOnly?: readonly string[];
  haltGraceMs?: number;
  /** Ctrl-C semantics for a trapped SIGINT (see cage-process.ts); defaults to whether stdin is a TTY. */
  interactive?: boolean;
  /** Called when a journal left by an interrupted session was recovered before this run; default prints one stderr line. */
  onRecovery?: (recovery: CageRecovery) => void;
  /** Baseline caps; defaults {@link CAGE_MAX_TARGETS} and {@link CAGE_MAX_SCAN_BYTES}. */
  maxTargets?: number;
  maxScanBytes?: number;
  /** Called once before the command starts, e.g. to print where the session log is. */
  onStart?: (info: {
    sessionLog: string | null;
    protectedFiles: number;
    watch: boolean;
    overrides: string[];
    configCommitted: boolean | null;
    dependencies: "revert" | "report";
    scope: CageScope | null;
  }) => void;
  bell?: () => void;
}

/** Zero-config root: the enclosing git work tree when there is one, otherwise the directory itself. */
export function resolveCageRoot(cwd: string): string {
  try {
    return canonicalCageRoot(getRepoRoot(cwd));
  } catch {
    return canonicalCageRoot(cwd);
  }
}

function countRefusedPushes(log: CageSessionLog | null): number {
  if (!log || !fs.existsSync(log.path)) return 0;
  return fs.readFileSync(log.path, "utf8").split("\n").filter((l) => l.includes('"event":"push_refused"')).length;
}

/** Live-restored changes first, then the final diff; a path changed again at exit takes the exit outcome. */
function mergeChanges(live: CageWatchSummary | null, final: CageResolvedChange[]): CageResolvedChange[] {
  const byPath = new Map<string, CageResolvedChange>(live ? live.restored : []);
  for (const c of final) {
    const earlier = byPath.get(c.abs);
    byPath.set(c.abs, earlier ? { ...c, kind: earlier.kind, before: earlier.before } : c);
  }
  return [...byPath.values()].sort((a, b) => a.rel.localeCompare(b.rel));
}

interface CageSettings {
  cwd: string;
  root: string;
  reportOnly: boolean;
  watch: boolean;
  intervalMs: number;
  pushGuard: boolean;
  snap: CageSnapshotOptions;
}

function resolveSettings(opts: CageRunOptions): CageSettings {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const reportOnly = opts.reportOnly === true;
  return {
    cwd,
    root: resolveCageRoot(cwd),
    reportOnly,
    watch: opts.watch !== false && !reportOnly,
    intervalMs: opts.watchIntervalMs ?? CAGE_DEFAULT_WATCH_INTERVAL_MS,
    pushGuard: opts.pushGuard !== false,
    snap: {
      keepBytes: !reportOnly,
      maxFileBytes: opts.maxFileBytes ?? CAGE_DEFAULT_MAX_FILE_BYTES,
      maxTotalBytes: opts.maxTotalBytes ?? CAGE_DEFAULT_MAX_TOTAL_BYTES,
    },
  };
}

interface CageSessionResult {
  proc: CageProcessResult;
  trappedSignal: NodeJS.Signals | null;
  live: CageWatchSummary | null;
  log: CageSessionLog | null;
  guarded: boolean;
  contestLimit: number;
}

/** CLI flag, then `.cage.yaml`, then the built-in default. */
function resolveContestLimit(opts: CageRunOptions, plan: ReturnType<typeof buildCagePlan>): number {
  return opts.contestLimit ?? plan.contestLimit ?? CAGE_CONTEST_LIMIT;
}

function defaultRecoveryNotice(r: CageRecovery): void {
  process.stderr.write(
    `cage: recovered an interrupted session (pid ${String(r.previousPid)}, started ${r.startedAt}): restored ${String(r.restored.length)} protected path(s), killed ${String(r.orphansKilled.length)} orphan process(es)\n`,
  );
}

/** Run the command with the session log, live watcher, push guard and pid journal; always tear them down. */
async function runSession(
  opts: CageRunOptions,
  s: CageSettings,
  plan: ReturnType<typeof buildCagePlan>,
  before: CageSnapshot,
  journal: CageJournalHandle,
): Promise<CageSessionResult> {
  const log = s.watch || s.pushGuard ? openCageSessionLog() : null;
  const guard = s.pushGuard ? createCagePushGuard(plan, log?.path ?? null) : null;
  opts.onStart?.({
    sessionLog: log?.path ?? null,
    protectedFiles: before.entries.size,
    watch: s.watch,
    overrides: plan.overrides,
    configCommitted: plan.config.committed,
    dependencies: plan.dependencies,
    scope: plan.scope,
  });
  // The session marker lets setup-only commands (cage suggest) refuse to run inside the cage.
  const graceMs = opts.haltGraceMs ?? CAGE_DEFAULT_HALT_GRACE_MS;
  const child = startCaged(opts.command, s.cwd, { ...guard?.env, [CAGE_SESSION_ENV]: "1" }, { graceMs, interactive: opts.interactive });
  // Journal the command and its descendants so a kill -9 on the wrapper can be cleaned up next time.
  journal.refreshPids(child.pid);
  const pidTimer = setInterval(() => journal.refreshPids(child.pid), Math.max(s.intervalMs, CAGE_JOURNAL_PID_REFRESH_MIN_MS));
  pidTimer.unref();
  const contestLimit = resolveContestLimit(opts, plan);
  const watcher =
    s.watch && log
      ? startCageWatch({
          plan,
          baseline: before,
          snapshotOptions: s.snap,
          intervalMs: s.intervalMs,
          log,
          bell: opts.bell,
          contestLimit: contestLimit > 0 ? contestLimit : CAGE_CONTEST_LIMIT,
          onHalt: contestLimit > 0 ? () => void child.terminate(graceMs) : undefined,
        })
      : null;
  try {
    const proc = await child.done;
    // After a halt or a trapped signal, wait for the whole tree to be gone before the exit diff.
    await child.settled();
    return { proc, trappedSignal: child.trappedSignal, live: watcher?.stop() ?? null, log, guarded: guard !== null, contestLimit };
  } finally {
    clearInterval(pidTimer);
    watcher?.stop();
    guard?.dispose();
  }
}

/**
 * Snapshot the protected set, run the command (restoring protected changes live unless `watch: false`),
 * diff once more at exit, and restore what is left. Bytes stay in memory and, for the kill -9 case, in a
 * hash-verified journal under the git dir (or the OS temp dir) that a clean shutdown removes; the session
 * log and the temporary hooks dir live in the OS temp dir, never in the repository.
 */
export async function runCage(opts: CageRunOptions): Promise<CageReport> {
  const s = resolveSettings(opts);
  // A journal left by an interrupted session is recovered first: orphans killed, baseline restored,
  // journal cleared. A corrupt journal or a still-running session fails closed before anything spawns.
  const journalDir = resolveCageJournalDir(s.root);
  const recovery = recoverCageJournal(s.root, journalDir, s.snap);
  if (recovery) (opts.onRecovery ?? defaultRecoveryNotice)(recovery);
  // Plan and baseline before spawning: an invalid manifest, .cage.yaml or override, a protected set over
  // the scan caps, or a revert-rule file over the per-file cap or the total budget, fails closed (exit 2)
  // and the command never runs; nothing is ever left detect-only.
  const plan = buildCagePlan(s.root, { overrides: opts.allowOverride, lockDeps: opts.lockDeps, allowOnly: opts.allowOnly });
  const limits = { maxTargets: opts.maxTargets ?? CAGE_MAX_TARGETS, maxScanBytes: opts.maxScanBytes ?? CAGE_MAX_SCAN_BYTES };
  // A scope keeps one temporary index for the session, so each check only hashes what changed.
  if (plan.scope) assertCageScopeGitRoot(s.root);
  const scopeIndex = plan.scope ? createCageScopeIndex(s.root) : undefined;
  const snap = { ...s.snap, scopeIndex };
  let changes: CageResolvedChange[];
  let session: CageSessionResult;
  let before: CageSnapshot;
  try {
    before = takeCageSnapshot(plan, { ...snap, limits });
    const journal = writeCageJournal(journalDir, s.root, before, plan.overrides, { lockDeps: opts.lockDeps, allowOnly: opts.allowOnly });
    session = await runSession(opts, { ...s, snap }, plan, before, journal);
    const after = takeCageSnapshot(plan, { ...snap, keepBytes: false });
    changes = mergeChanges(session.live, resolveCageChanges(diffCageSnapshots(before, after), { reportOnly: s.reportOnly }));
    // Everything the session had to restore is restored: the journal has served its purpose.
    journal.dispose();
  } finally {
    if (scopeIndex) disposeCageScopeIndex(scopeIndex);
  }
  const { proc, trappedSignal, live, log, guarded, contestLimit } = session;

  return buildCageReport({
    command: opts.command[0] ?? "",
    commandExitCode: proc.code,
    commandSignal: proc.signal,
    trappedSignal,
    runtimeError: proc.spawnError,
    recovery,
    root: s.root,
    reportOnly: s.reportOnly,
    maxFileBytes: s.snap.maxFileBytes,
    protectedFiles: before.entries.size,
    manifestZones: plan.manifestZoneCount,
    cageConfig: plan.config,
    dependencies: plan.dependencies,
    scope: plan.scope,
    overrides: plan.overrides,
    changes,
    watch: {
      enabled: s.watch,
      interval_ms: s.watch ? s.intervalMs : null,
      live_restores: live?.liveRestores ?? 0,
      contested: live?.contested ?? [],
      contest_limit: contestLimit,
      halt: live?.halt ? { path: live.halt.path, rule: live.halt.rule, live_restores: live.halt.liveRestores } : null,
      session_log: log?.path ?? null,
    },
    pushGuard: { enabled: guarded, refused_pushes: countRefusedPushes(log) },
    signalExitCode,
  });
}
