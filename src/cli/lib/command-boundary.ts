import { CLI_NAME } from "./constants.js";
import { errorMessage, logError, setExitCode } from "./cli-io.js";
import { getRepoRoot } from "./git.js";

/**
 * Command-boundary error helpers: commands resolve their repo root and report
 * boundary failures through one place instead of hand-rolled try/catch copies.
 */

/** Report a command-boundary failure: log the message and set the exit code once. */
export function reportCommandError(e: unknown, exitCode = 2): void {
  logError(errorMessage(e));
  setExitCode(exitCode);
}

/**
 * Resolve the git repo root at the command boundary.
 * On failure logs the message (stripping the CLI prefix `logError` re-adds) and exits 2.
 */
export function resolveRepoRootAtBoundary(cwd?: string): string | null {
  try {
    return getRepoRoot(cwd);
  } catch (e) {
    logError(e instanceof Error ? e.message.replace(`${CLI_NAME}: `, "") : String(e));
    setExitCode(2);
    return null;
  }
}

/** Run a command body; any thrown error is reported once with the given exit code. */
export function runAtCommandBoundary(exitCode: number, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    reportCommandError(e, exitCode);
  }
}

/** Async variant of {@link runAtCommandBoundary}. */
export async function runAtCommandBoundaryAsync(
  exitCode: number,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (e) {
    reportCommandError(e, exitCode);
  }
}
