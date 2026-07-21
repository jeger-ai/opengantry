import {
  buildAttestationReceipt,
  writeAttestationReceipt,
  type AttestationReceipt,
} from "./attestation-receipt.js";
import { GantryUserError } from "./errors.js";
import { assertMissionGatePresent, parseMissionFile } from "./missions/parser.js";
import { loadWorkspace } from "./workspace.js";

export interface AttestMissionOptions {
  mission: string;
  out?: string;
  sign?: boolean;
}

export interface AttestMissionResult {
  receipt: AttestationReceipt;
  receipt_path: string;
}

export function attestMission(options: AttestMissionOptions): AttestMissionResult {
  if (!options.mission?.trim()) {
    throw new GantryUserError("INVALID_ARGUMENT", "gantry attest: --mission is required", undefined, 2);
  }
  const { root } = loadWorkspace();
  const mission = parseMissionFile(root, options.mission);
  assertMissionGatePresent(mission);
  const receipt = buildAttestationReceipt({
    root,
    mission,
    missionArg: options.mission,
    verifyStatus: "attest_only",
    sign: options.sign === true,
  });
  const receipt_path = writeAttestationReceipt(root, receipt, options.out);
  return { receipt, receipt_path };
}
