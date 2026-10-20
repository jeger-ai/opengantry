import {
  buildAttestationReceipt as buildWithIdentity,
  resolvePlannerStampForReceipt as resolveStampWithEmails,
  type AttestationReceipt,
  type AttestationVerifyStatus,
  type PlannerStampReceipt,
} from "#plane/attestation-receipt.js";
import type { AttestationHarnessMode } from "#plane/receipt-attribution.js";
import { logWarn } from "./cli-io.js";
import { CLI_NAME } from "#core/constants.js";
import { CLI_VERSION } from "./version.gen.js";
import { loadGxtConfig } from "#missions/gxt-config.js";
import { resolveReceiptSignatureTier } from "#core/config.js";
import { resolvePlannerEmails } from "#missions/planner-identity.js";
import type { ParsedMission } from "#core/mission-types.js";

export interface BuildAttestationReceiptInput {
  root: string;
  mission: ParsedMission;
  missionArg: string;
  verifyStatus: AttestationVerifyStatus;
  errorCode?: string;
  sign?: boolean;
  harnessMode?: AttestationHarnessMode;
}

export function resolvePlannerStampForReceipt(root: string, msnId: string, orgPepper: string): PlannerStampReceipt | null {
  return resolveStampWithEmails(root, msnId, orgPepper, resolvePlannerEmails(root).emails);
}

export function buildAttestationReceipt(input: BuildAttestationReceiptInput): AttestationReceipt {
  const built = buildWithIdentity({
    ...input,
    plannerEmails: resolvePlannerEmails(input.root).emails,
    receiptSignatureTier: resolveReceiptSignatureTier(loadGxtConfig(input.root)),
    cliVersion: CLI_VERSION,
  });
  for (const w of built.warnings) logWarn(`${CLI_NAME} ${w}`);
  return built.receipt;
}
