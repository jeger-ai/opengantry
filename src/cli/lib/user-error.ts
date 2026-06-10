import { logError, setExitCode, errorMessage } from "./cli-io.js";
import { hintGitProofFromMessage, logFixHint } from "./fix-hints.js";
import { gxtCodeFromGapmanUserError } from "./gxt-error-codes.js";

/** Expected policy / validation failure — never print a stack at the CLI boundary. */
export class GapmanUserError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = "GapmanUserError";
  }

  /** Stable GXT error code for JSON/MCP consumers. */
  get gxtCode(): string {
    return gxtCodeFromGapmanUserError(this.code);
  }
}

export function isGapmanUserError(e: unknown): e is GapmanUserError {
  return e instanceof GapmanUserError;
}

function logUnexpectedError(error: Error): void {
  if (process.env.GAPMAN_DEBUG === "1") {
    logError(error.stack ?? error.message);
  } else {
    logError(error.message);
  }
}

/** User-facing failure reporter: message + optional Fix: hint, no stack by default. */
export function reportUserFacingError(e: unknown): void {
  if (isGapmanUserError(e)) {
    logError(`[${e.gxtCode}] ${e.message}`);
    if (e.hint) logFixHint(e.hint);
    setExitCode(e.exitCode);
    return;
  }

  if (e instanceof Error) {
    logUnexpectedError(e);
    const legacyHint = hintGitProofFromMessage(e.message);
    if (legacyHint) logFixHint(legacyHint);
    setExitCode(1);
    return;
  }

  logError(String(e));
  setExitCode(1);
}

export interface UserFacingErrorJson {
  error_code: string;
  message: string;
  hint?: string;
  exit_code: number;
}

export function userFacingErrorToJson(e: unknown): UserFacingErrorJson {
  if (isGapmanUserError(e)) {
    return {
      error_code: e.gxtCode,
      message: e.message,
      hint: e.hint,
      exit_code: e.exitCode,
    };
  }
  const message = errorMessage(e);
  return { error_code: "GXT_VERIFY_FAILED", message, exit_code: 1 };
}
