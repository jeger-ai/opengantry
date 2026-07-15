import type { GxtErrorCode } from "../gxt-error-codes.js";
import { GXT_ERROR } from "../gxt-error-codes.js";
import { gateOutputIndicatesBannedImport } from "../banned-import-violation.js";
import { gateOutputIndicatesImportLayer } from "../surgeon.js";
import type { GateFailure, VerifyPhaseFailure } from "../verify-failure.js";
import type { Manifest } from "../types.js";
import { bannedImportSurgeon } from "./banned-import.js";
import { importLayerSurgeon } from "./import-layer.js";

export interface SurgeonMutationResult {
  mutated: boolean;
  summary: string;
}

/** Surgeons operate exclusively on gate failures (they parse gate output). */
export interface SurgeonContext {
  root: string;
  failure: GateFailure;
  manifest: Manifest;
  executorLogPath: string;
  errorCode: GxtErrorCode;
}

export interface CodeSurgeon {
  errorCode: GxtErrorCode;
  applyMutation(context: SurgeonContext): Promise<SurgeonMutationResult>;
}

const SURGEONS: CodeSurgeon[] = [importLayerSurgeon, bannedImportSurgeon];

export function getSurgeonForErrorCode(code: GxtErrorCode): CodeSurgeon | undefined {
  return SURGEONS.find((s) => s.errorCode === code);
}

export function resolveSurgeonErrorCode(failure: VerifyPhaseFailure): GxtErrorCode | null {
  if (failure.phase !== "gate") return null;
  const stdout = failure.gateStdout ?? "";
  const stderr = failure.gateStderr ?? "";
  const combined = `${stderr}\n${stdout}`;

  if (gateOutputIndicatesImportLayer(stdout) || gateOutputIndicatesImportLayer(stderr)) {
    return GXT_ERROR.IMPORT_LAYER_VIOLATION;
  }
  if (gateOutputIndicatesBannedImport(combined) || /: banned import "/.test(combined)) {
    return GXT_ERROR.BANNED_IMPORT_DETECTED;
  }
  return null;
}
