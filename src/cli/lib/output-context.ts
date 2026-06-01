import type { OutputAudience } from "./audience-output.js";
import { resolveAudience } from "./audience-output.js";

let activeAudience: OutputAudience | undefined;
let jsonOutputMode = false;

const GXT_ERROR_PREFIX_RE = /\[GXT_[A-Z0-9_]+\]/;

/** Reset per process invocation (tests may call multiple commands in one process). */
export function resetOutputContext(): void {
  activeAudience = undefined;
  jsonOutputMode = false;
}

export function setOutputAudience(audience: OutputAudience | undefined): void {
  activeAudience = audience;
}

export function getOutputAudience(): OutputAudience | undefined {
  return activeAudience;
}

export function setJsonOutputMode(enabled: boolean): void {
  jsonOutputMode = enabled;
}

export function isJsonOutputMode(): boolean {
  return jsonOutputMode;
}

export function isVerifierAudience(): boolean {
  return activeAudience === "verifier";
}

export function shouldEmitInfo(): boolean {
  if (jsonOutputMode) return true;
  return !isVerifierAudience();
}

export function shouldEmitWarn(): boolean {
  if (jsonOutputMode) return true;
  return !isVerifierAudience();
}

/** Verifier mode: stderr only when message carries a stable GXT error code. */
export function shouldEmitError(message: string): boolean {
  if (jsonOutputMode) return true;
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
