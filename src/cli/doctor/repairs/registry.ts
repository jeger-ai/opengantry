import type { GxtErrorCode } from "#core/error-codes.js";
import { GXT_ERROR } from "#core/error-codes.js";
import { gateOutputIndicatesImportLayer } from "#missions/repair.js";
import type { GateFailure, VerifyPhaseFailure } from "#missions/mission-verify/failure.js";
import type { Manifest } from "#core/manifest.js";
import { importLayerRepair } from "./import-layer.js";

export interface RepairMutationResult {
  mutated: boolean;
  summary: string;
}

/** Repairs operate exclusively on gate failures (they parse gate output). */
export interface RepairContext {
  root: string;
  failure: GateFailure;
  manifest: Manifest;
  executorLogPath: string;
  errorCode: GxtErrorCode;
}

export interface CodeRepair {
  errorCode: GxtErrorCode;
  applyMutation(context: RepairContext): Promise<RepairMutationResult>;
}

const REPAIRS: CodeRepair[] = [importLayerRepair];

export function getRepairForErrorCode(code: GxtErrorCode): CodeRepair | undefined {
  return REPAIRS.find((s) => s.errorCode === code);
}

export function resolveRepairErrorCode(failure: VerifyPhaseFailure): GxtErrorCode | null {
  if (failure.phase !== "gate") return null;
  const combined = failure.gateOutput ?? "";

  if (gateOutputIndicatesImportLayer(combined)) {
    return GXT_ERROR.IMPORT_LAYER_VIOLATION;
  }
  return null;
}
