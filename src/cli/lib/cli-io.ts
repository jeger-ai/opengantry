import path from "node:path";
import { CLI_NAME } from "./constants.js";
import { shouldEmitError, shouldEmitInfo, shouldEmitWarn } from "./output-context.js";

export function logInfo(message: string): void {
  if (!shouldEmitInfo()) return;
  console.log(message);
}

export function logWarn(message: string): void {
  if (!shouldEmitWarn()) return;
  console.error(`${CLI_NAME}: warning: ${message}`);
}

export function logError(message: string): void {
  if (!shouldEmitError(message)) return;
  console.error(`${CLI_NAME}: ${message}`);
}

/** Red stderr for existing managed-asset conflicts (respects NO_COLOR). */
export function logManagedAssetConflicts(conflicts: string[]): void {
  if (!shouldEmitWarn()) return;
  const useColor = process.env.NO_COLOR === undefined;
  const red = useColor ? "\x1b[31m" : "";
  const reset = useColor ? "\x1b[0m" : "";
  console.error(
    `${red}${CLI_NAME}: warning: managed files already exist and differ from templates:${reset}`,
  );
  for (const rel of conflicts) {
    console.error(`${red}  - ${rel}${reset}`);
  }
}

/** POSIX repo-relative path (stable across platforms). */
export function toPosixRel(repoRoot: string, absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

/** Convert a POSIX repo-relative path to native separators. */
export function fromPosix(posixPath: string): string {
  return posixPath.split("/").join(path.sep);
}

/** Relative path for user-facing messages (POSIX-normalized). */
export function formatRepoRelative(repoRoot: string, absolutePath: string): string {
  return toPosixRel(repoRoot, absolutePath);
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Absolute path under repo root from a POSIX repo-relative segment. */
export function repoAbsPath(repoRoot: string, posixRel: string): string {
  return path.join(repoRoot, fromPosix(posixRel));
}

export function setExitCode(code: number): void {
  process.exitCode = code;
}

/** Strict `--timeout-ms` parsing for CLI boundary (reject NaN/non-integer junk). */
export function parseOptionalTimeoutMs(
  raw: string | undefined,
): { ok: true; ms: number | undefined } | { ok: false; message: string } {
  if (raw === undefined) return { ok: true, ms: undefined };
  const t = raw.trim();
  if (t === "") return { ok: true, ms: undefined };
  if (!/^\d+$/.test(t)) {
    return {
      ok: false,
      message: "gantry: runtime exec: --timeout-ms must be a non-negative integer",
    };
  }
  const n = Number.parseInt(t, 10);
  return { ok: true, ms: Number.isFinite(n) ? n : undefined };
}
