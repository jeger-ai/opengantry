import fs from "node:fs";
import path from "node:path";
import { getRepoRoot } from "../git/git.js";
import { buildCageReport, type CageReport } from "./cage-report.js";
import { resolveCageChanges, type CageResolvedChange } from "./cage-revert.js";
import { buildCagePlan } from "./cage-rules.js";
import {
  CAGE_MAX_SCAN_BYTES,
  CAGE_MAX_TARGETS,
  diffCageSnapshots,
  takeCageSnapshot,
  type CageSnapshot,
  type CageSnapshotOptions,
} from "./cage-snapshot.js";
import { signalExitCode, spawnCaged } from "./cage-process.js";
import { createCagePushGuard } from "./cage-push-guard.js";
import {
  CAGE_DEFAULT_WATCH_INTERVAL_MS,
  openCageSessionLog,
  startCageWatch,
  type CageSessionLog,
  type CageWatchSummary,
} from "./cage-watch.js";

/** Per-file in-memory snapshot cap; larger revert-mode files are detect-only. */
export const CAGE_DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Total in-memory snapshot budget across all protected files. */
export const CAGE_DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

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
  /** Baseline caps; defaults {@link CAGE_MAX_TARGETS} and {@link CAGE_MAX_SCAN_BYTES}. */
  maxTargets?: number;
  maxScanBytes?: number;
  /** Called once before the command starts, e.g. to print where the session log is. */
  onStart?: (info: { sessionLog: string | null; protectedFiles: number; watch: boolean; overrides: string[] }) => void;
  bell?: () => void;
}

/** Zero-config root: the enclosing git work tree when there is one, otherwise the directory itself. */
export function resolveCageRoot(cwd: string): string {
  try {
    return getRepoRoot(cwd);
  } catch {
    return path.resolve(cwd);
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
  proc: Awaited<ReturnType<typeof spawnCaged>>;
  live: CageWatchSummary | null;
  log: CageSessionLog | null;
  guarded: boolean;
}

/** Run the command with the session log, live watcher and push guard; always tear the guard down. */
async function runSession(
  opts: CageRunOptions,
  s: CageSettings,
  plan: ReturnType<typeof buildCagePlan>,
  before: CageSnapshot,
): Promise<CageSessionResult> {
  const log = s.watch || s.pushGuard ? openCageSessionLog() : null;
  const guard = s.pushGuard ? createCagePushGuard(plan, log?.path ?? null) : null;
  opts.onStart?.({
    sessionLog: log?.path ?? null,
    protectedFiles: before.entries.size,
    watch: s.watch,
    overrides: plan.overrides,
  });
  const watcher =
    s.watch && log
      ? startCageWatch({ plan, baseline: before, snapshotOptions: s.snap, intervalMs: s.intervalMs, log, bell: opts.bell })
      : null;
  try {
    const proc = await spawnCaged(opts.command, s.cwd, guard?.env ?? {});
    return { proc, live: watcher?.stop() ?? null, log, guarded: guard !== null };
  } finally {
    watcher?.stop();
    guard?.dispose();
  }
}

/**
 * Snapshot the protected set, run the command (restoring protected changes live unless `watch: false`),
 * diff once more at exit, and restore what is left. Bytes stay in memory; the session log and the
 * temporary hooks dir live in the OS temp dir, never in the repository.
 */
export async function runCage(opts: CageRunOptions): Promise<CageReport> {
  const s = resolveSettings(opts);
  // Plan and baseline before spawning: an invalid manifest, .cage.yaml or override, or a protected set
  // over the caps, fails closed and the command never runs.
  const plan = buildCagePlan(s.root, { overrides: opts.allowOverride });
  const limits = { maxTargets: opts.maxTargets ?? CAGE_MAX_TARGETS, maxScanBytes: opts.maxScanBytes ?? CAGE_MAX_SCAN_BYTES };
  const before = takeCageSnapshot(plan, { ...s.snap, limits });
  const { proc, live, log, guarded } = await runSession(opts, s, plan, before);
  const after = takeCageSnapshot(plan, { ...s.snap, keepBytes: false });
  const changes = mergeChanges(live, resolveCageChanges(diffCageSnapshots(before, after), { reportOnly: s.reportOnly }));

  return buildCageReport({
    command: opts.command[0] ?? "",
    commandExitCode: proc.code,
    commandSignal: proc.signal,
    runtimeError: proc.spawnError,
    root: s.root,
    reportOnly: s.reportOnly,
    maxFileBytes: s.snap.maxFileBytes,
    protectedFiles: before.entries.size,
    manifestZones: plan.manifestZoneCount,
    cageConfig: plan.config,
    overrides: plan.overrides,
    changes,
    watch: {
      enabled: s.watch,
      interval_ms: s.watch ? s.intervalMs : null,
      live_restores: live?.liveRestores ?? 0,
      contested: live?.contested ?? [],
      session_log: log?.path ?? null,
    },
    pushGuard: { enabled: guarded, refused_pushes: countRefusedPushes(log) },
    signalExitCode,
  });
}
