import {
  buildAttestationReceipt,
  writeAttestationReceipt,
  type AttestationReceipt,
} from "./attestation-receipt.js";
import { writeAttestationExportEnvelope } from "./attestation-export.js";
import type { ResolvedMissionArg } from "./mission-arg.js";
import type { AttestationHarnessMode } from "./receipt-attribution.js";
import { assertMissionGatePresent, parseMissionFile } from "./missions/parser.js";

export interface AttestMissionOptions {
  root: string;
  resolved: ResolvedMissionArg;
  out?: string;
  exportPath?: string;
  sign?: boolean;
  harnessMode?: AttestationHarnessMode;
}

export interface AttestMissionResult {
  repo_root: string;
  receipt: AttestationReceipt;
  receipt_path: string;
  export_path?: string;
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
    harnessMode: options.harnessMode,
  });
  const receipt_path = writeAttestationReceipt(root, receipt, options.out);
  let export_path: string | undefined;
  if (options.exportPath?.trim()) {
    export_path = writeAttestationExportEnvelope(root, receipt, options.exportPath.trim());
  }
  return {
    repo_root: root,
    receipt,
    receipt_path,
    export_path,
    mission_file_path: resolved.missionRel,
    mission_source: resolved.source,
  };
}
