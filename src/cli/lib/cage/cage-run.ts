import path from "node:path";
import { getRepoRoot } from "../git/git.js";
import { buildCageReport, type CageReport } from "./cage-report.js";
import { resolveCageChanges } from "./cage-revert.js";
import { buildCagePlan } from "./cage-rules.js";
import { diffCageSnapshots, takeCageSnapshot } from "./cage-snapshot.js";
import { signalExitCode, spawnCaged } from "./cage-process.js";

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
}

/** Zero-config root: the enclosing git work tree when there is one, otherwise the directory itself. */
export function resolveCageRoot(cwd: string): string {
  try {
    return getRepoRoot(cwd);
  } catch {
    return path.resolve(cwd);
  }
}

/**
 * Snapshot the protected set, run the command, diff, and revert protected changes.
 * Bytes stay in memory only; nothing is written outside the restored paths.
 */
export async function runCage(opts: CageRunOptions): Promise<CageReport> {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const root = resolveCageRoot(cwd);
  const maxFileBytes = opts.maxFileBytes ?? CAGE_DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = opts.maxTotalBytes ?? CAGE_DEFAULT_MAX_TOTAL_BYTES;
  const reportOnly = opts.reportOnly === true;

  // Plan before spawning: an invalid manifest fails closed and the command never runs.
  const plan = buildCagePlan(root);
  const before = takeCageSnapshot(plan, { keepBytes: !reportOnly, maxFileBytes, maxTotalBytes });
  const proc = await spawnCaged(opts.command, cwd);
  const after = takeCageSnapshot(plan, { keepBytes: false, maxFileBytes, maxTotalBytes });
  const changes = resolveCageChanges(diffCageSnapshots(before, after), { reportOnly });

  return buildCageReport({
    command: opts.command[0] ?? "",
    commandExitCode: proc.code,
    commandSignal: proc.signal,
    runtimeError: proc.spawnError,
    root,
    reportOnly,
    maxFileBytes,
    protectedFiles: before.entries.size,
    manifestZones: plan.manifestZoneCount,
    changes,
    signalExitCode,
  });
}
