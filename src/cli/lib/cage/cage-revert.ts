import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CageChange, CageEntry } from "./cage-snapshot.js";

/**
 * - `reverted`: baseline bytes (or symlink) restored
 * - `removed`: an added file was deleted
 * - `kept`: report-only rule (lockfiles); change left in place
 * - `reported`: `--report-only` run; change left in place
 * - `detect_only`: no baseline bytes (over size cap or budget); change left in place
 * - `revert_failed`: restore attempted and failed (`error_code` says why)
 */
export type CageOutcome = "reverted" | "removed" | "kept" | "reported" | "detect_only" | "revert_failed";

export interface CageResolvedChange extends CageChange {
  outcome: CageOutcome;
  errorCode: string | null;
}

function errnoCode(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" ? code : "ERROR";
}

/** Write to a sibling temp file and rename over the target so a failed restore never truncates it. */
function restoreFile(abs: string, entry: CageEntry, bytes: Buffer): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.gantry-cage-${String(process.pid)}-${crypto.randomBytes(4).toString("hex")}`;
  try {
    fs.writeFileSync(tmp, bytes, { mode: entry.fileMode });
    fs.chmodSync(tmp, entry.fileMode);
    fs.renameSync(tmp, abs);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

function restoreSymlink(abs: string, target: string): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.rmSync(abs, { force: true });
  fs.symlinkSync(target, abs);
}

function revertChange(change: CageChange): CageOutcome {
  if (change.kind === "added") {
    fs.rmSync(change.abs, { force: true });
    return "removed";
  }
  const before = change.before!;
  if (before.type === "symlink") {
    restoreSymlink(change.abs, before.linkTarget!);
    return "reverted";
  }
  if (!before.bytes) return "detect_only";
  restoreFile(change.abs, before, before.bytes);
  return "reverted";
}

export function resolveCageChanges(
  changes: readonly CageChange[],
  opts: { reportOnly: boolean },
): CageResolvedChange[] {
  return changes.map((change) => {
    if (change.mode === "report") return { ...change, outcome: "kept", errorCode: null };
    if (opts.reportOnly) return { ...change, outcome: "reported", errorCode: null };
    try {
      return { ...change, outcome: revertChange(change), errorCode: null };
    } catch (err) {
      return { ...change, outcome: "revert_failed", errorCode: errnoCode(err) };
    }
  });
}
