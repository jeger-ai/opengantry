import { CLI_NAME } from "./constants.js";
import { errorMessage, logError, setExitCode } from "./cli-io.js";
import { getRepoRoot } from "./git.js";
import { GantryUserError, isGantryUserError, reportUserFacingError, userFacingErrorToJson } from "./errors.js";

/**
 * Command-boundary error helpers: commands resolve their repo root and report
 * boundary failures through one place instead of hand-rolled try/catch copies.
 */

export interface CliFailureEnvelope {
  status: "failed";
  error_code: string;
  message: string;
  fix_hints: string[];
  exit_code: number;
}

/** Sole serializer for stdout JSON from commands (success and failure). */
export function emitCliJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function cliFailureEnvelope(e: unknown): CliFailureEnvelope {
  const json = userFacingErrorToJson(e);
  return {
    status: "failed",
    error_code: json.error_code,
    message: json.message,
    fix_hints: json.hint ? [json.hint] : [],
    exit_code: json.exit_code,
  };
}

function exitCodeFor(e: unknown): number {
  if (isGantryUserError(e)) return e.exitCode;
  return 1;
}

/** Run a sync command body with one JSON-aware error boundary. */
export function runUserCommand(opts: { json?: boolean }, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    if (opts.json) {
      emitCliJson(cliFailureEnvelope(e));
      setExitCode(exitCodeFor(e));
    } else {
      reportUserFacingError(e);
    }
  }
}

/** Async variant of {@link runUserCommand}. */
export async function runUserCommandAsync(
  opts: { json?: boolean },
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (e) {
    if (opts.json) {
      emitCliJson(cliFailureEnvelope(e));
      setExitCode(exitCodeFor(e));
    } else {
      reportUserFacingError(e);
    }
  }
}

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
