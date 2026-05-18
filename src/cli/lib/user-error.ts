import { logError, setExitCode } from "./cli-io.js";
import { hintGitProofFromMessage, logFixHint } from "./fix-hints.js";

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
    logError(e.message);
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
