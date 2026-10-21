import { EXIT_CODE } from "#core/exit-codes.js";
import { CLI_NAME } from "#core/constants.js";
import { errorMessage, isGantryUserError } from "#core/user-error.js";
import { logError, logInfo, setExitCode, writeStdout } from "./cli-io.js";
import { getRepoRoot } from "#git/git.js";
import { reportUserFacingError } from "./errors.js";
import { userFacingErrorToJson } from "#missions/error-payloads.js";

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
  writeStdout(JSON.stringify(payload, null, 2));
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

/** How a command runs its body: JSON on stdout or human lines; `exitCode` for an error that carries none. */
export interface CommandRunOptions {
  json?: boolean;
  exitCode?: number;
}

function exitCodeFor(e: unknown, fallback: number): number {
  if (isGantryUserError(e)) return e.exitCode;
  return fallback;
}

function reportCommandFailure(opts: CommandRunOptions, e: unknown): void {
  const fallback = opts.exitCode ?? EXIT_CODE.FAILURE;
  if (opts.json) {
    emitCliJson(cliFailureEnvelope(e));
    setExitCode(exitCodeFor(e, fallback));
  } else {
    reportUserFacingError(e, fallback);
  }
}

export type CommandPresentation = {
  json: unknown;
  human?: string | readonly string[];
};

function presentCommand(opts: { json?: boolean }, view: CommandPresentation): void {
  if (opts.json) {
    emitCliJson(view.json);
    return;
  }
  const raw = view.human;
  const lines = raw === undefined ? [] : typeof raw === "string" ? [raw] : [...raw];
  for (const line of lines) {
    if (line.length > 0) logInfo(line);
  }
}

/** Run a sync command body with one JSON-aware error and success boundary. */
export function runUserCommand(opts: CommandRunOptions, fn: () => CommandPresentation | void): void {
  try {
    const view = fn();
    if (view !== undefined) presentCommand(opts, view);
  } catch (e) {
    reportCommandFailure(opts, e);
  }
}

/** Async variant of {@link runUserCommand}. */
export async function runUserCommandAsync(
  opts: CommandRunOptions,
  fn: () => Promise<CommandPresentation | void>,
): Promise<void> {
  try {
    const view = await fn();
    if (view !== undefined) presentCommand(opts, view);
  } catch (e) {
    reportCommandFailure(opts, e);
  }
}

/** Report a command-boundary failure: log the message and set the exit code once. */
export function reportCommandError(e: unknown, exitCode: number = EXIT_CODE.USAGE): void {
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
    setExitCode(EXIT_CODE.USAGE);
    return null;
  }
}
