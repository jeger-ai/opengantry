import {
  buildAttestationReceipt,
  writeAttestationReceipt,
  type AttestationReceipt,
} from "./attestation-receipt.js";
import type { ResolvedMissionArg } from "./mission-arg.js";
import { assertMissionGatePresent, parseMissionFile } from "./missions/parser.js";

export interface AttestMissionOptions {
  root: string;
  resolved: ResolvedMissionArg;
  out?: string;
  sign?: boolean;
}

export interface AttestMissionResult {
  repo_root: string;
  receipt: AttestationReceipt;
  receipt_path: string;
  mission_file_path: string;
  mission_source: "flag" | "pin";
}

export function attestMission(options: AttestMissionOptions): AttestMissionResult {
  const { root, resolved } = options;
  const mission = parseMissionFile(root, resolved.missionRel);
  assertMissionGatePresent(mission);
  const receipt = buildAttestationReceipt({
    root,
    mission,
    missionArg: resolved.missionRel,
    verifyStatus: "attest_only",
    sign: options.sign === true,
  });
  const receipt_path = writeAttestationReceipt(root, receipt, options.out);
  return {
    repo_root: root,
    receipt,
    receipt_path,
    mission_file_path: resolved.missionRel,
    mission_source: resolved.source,
  };
}
