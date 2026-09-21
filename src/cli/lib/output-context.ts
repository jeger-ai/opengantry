import type { OutputAudience } from "./audience-output.js";
import { resolveAudience } from "./audience-output.js";

let activeAudience: OutputAudience | undefined;
let documentStdoutDepth = 0;

const GXT_ERROR_PREFIX_RE = /\[GXT_[A-Z0-9_]+\]/;

/** Reset per process invocation (tests may call multiple commands in one process). */
export function resetOutputContext(): void {
  activeAudience = undefined;
  documentStdoutDepth = 0;
}

export function setOutputAudience(audience: OutputAudience | undefined): void {
  activeAudience = audience;
}

export function getOutputAudience(): OutputAudience | undefined {
  return activeAudience;
}

/**
 * Document stdout depth. Diagnostics go to stderr while the count is above zero.
 * Callers enter and leave in pairs so overlapping commands cannot clear each other.
 */
export function enterDocumentStdout(): void {
  documentStdoutDepth += 1;
}

export function leaveDocumentStdout(): void {
  if (documentStdoutDepth > 0) documentStdoutDepth -= 1;
}

export function isDocumentStdout(): boolean {
  return documentStdoutDepth > 0;
}

export function isVerifierAudience(): boolean {
  return activeAudience === "verifier";
}

export function shouldEmitInfo(): boolean {
  if (isDocumentStdout()) return true;
  return !isVerifierAudience();
}

export function shouldEmitWarn(): boolean {
  if (isDocumentStdout()) return true;
  return !isVerifierAudience();
}

/** Verifier mode: stderr only when message carries a stable GXT error code. */
export function shouldEmitError(message: string): boolean {
  if (isDocumentStdout()) return true;
  if (!isVerifierAudience()) return true;
  return GXT_ERROR_PREFIX_RE.test(message);
}

export interface ApplyAudienceFromArgvResult {
  ok: boolean;
  invalidValue?: string;
}

/**
 * Resolve CLI/env audience and store on output context.
 * Precedence: subcommand --audience > global --audience > GXT_AUDIENCE.
 */
export function applyAudienceFromArgv(
  cliRaw?: string,
  envRaw = process.env.GXT_AUDIENCE,
): ApplyAudienceFromArgvResult {
  const resolved = resolveAudience(cliRaw, envRaw);
  if (resolved.invalidCli) {
    return { ok: false, invalidValue: resolved.invalidCli };
  }
  setOutputAudience(resolved.audience);
  return { ok: true };
}
