import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readCageScopeBlob } from "./cage-scope.js";
import type { CageChange, CageEntry } from "./cage-snapshot.js";

/**
 * - `reverted`: baseline bytes (or symlink) restored
 * - `removed`: an added file was deleted
 * - `kept`: report-only rule (lockfiles, report entries, `--allow-override`); change left in place
 * - `reported`: `--report-only` run; change left in place
 * - `detect_only`: no baseline bytes; change left in place. No longer produced for revert-rule files since
 *   MSN-0254 (a file the snapshot cannot hold stops cage before the command runs, exit 2); kept in the
 *   union so `gantry.cage-report.v1` consumers that match on it keep parsing.
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
  // Out-of-scope entries keep no bytes: the baseline is a blob in the scope tree.
  const fromGit = !before.bytes && before.git ? readCageScopeBlob(before.git.root, before.rel, before.git.oid) : null;
  if (before.type === "symlink") {
    restoreSymlink(change.abs, before.linkTarget ?? fromGit!.toString("utf8"));
    return "reverted";
  }
  const bytes = before.bytes ?? fromGit;
  if (!bytes) return "detect_only";
  restoreFile(change.abs, before, bytes);
  return "reverted";
}

/** A `.gitignore` the cage put back: files it had hidden from a scope are visible again. */
export function restoredGitignore(c: CageResolvedChange): boolean {
  return (c.outcome === "reverted" || c.outcome === "removed") && path.posix.basename(c.rel) === ".gitignore";
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
