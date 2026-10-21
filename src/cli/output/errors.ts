import { EXIT_CODE } from "#core/exit-codes.js";
import { readGantryEnv } from "#missions/config-namespace.js";
import { logError, logFixHint, setExitCode } from "./cli-io.js";
import { isGantryUserError } from "#core/user-error.js";
import { hintGitProofFromMessage } from "#missions/fix-hints.js";

function logUnexpectedError(error: Error): void {
  if (readGantryEnv("DEBUG") === "1") {
    logError(error.stack ?? error.message);
  } else {
    logError(error.message);
  }
}

/** User-facing failure reporter: message + optional Fix: hint, no stack by default; `exitCode` is for errors that carry none. */
export function reportUserFacingError(e: unknown, exitCode: number = EXIT_CODE.FAILURE): void {
  if (isGantryUserError(e)) {
    logError(`[${e.gxtCode}] ${e.message}`);
    if (e.hint) logFixHint(e.hint);
    setExitCode(e.exitCode);
    return;
  }

  if (e instanceof Error) {
    logUnexpectedError(e);
    const legacyHint = hintGitProofFromMessage(e.message);
    if (legacyHint) logFixHint(legacyHint);
    setExitCode(exitCode);
    return;
  }

  logError(String(e));
  setExitCode(exitCode);
}
