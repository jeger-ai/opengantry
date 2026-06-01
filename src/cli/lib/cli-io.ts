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

/** Relative path for user-facing messages */
export function formatRepoRelative(repoRoot: string, absolutePath: string): string {
  return path.relative(repoRoot, absolutePath);
}

export function setExitCode(code: number): void {
  process.exitCode = code;
}
