import type { GxtErrorCode } from "#core/error-codes.js";
import type { GateFailure } from "#missions/mission-verify/failure.js";
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
