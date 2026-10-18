// Facade (ADR-0052 step 5c-ii): the receipt lives in packages/plane; identity, config and logging stay here.
export {
  ATTESTATION_RECEIPT_SCHEMA_VERSION,
  computeReceiptSha256,
  defaultReceiptPath,
  writeAttestationReceipt,
  type AttestationReceipt,
  type AttestationVerifyStatus,
  type PlannerStampReceipt,
  type ReceiptSignatureVerifyStatus,
} from "#plane/attestation-receipt.js";
import {
  buildAttestationReceipt as buildWithIdentity,
  resolvePlannerStampForReceipt as resolveStampWithEmails,
  type AttestationReceipt,
  type AttestationVerifyStatus,
  type PlannerStampReceipt,
} from "#plane/attestation-receipt.js";
import type { AttestationHarnessMode } from "#plane/receipt-attribution.js";
import { logWarn } from "./cli-io.js";
import { CLI_NAME, CLI_VERSION } from "./constants.js";
import { loadGxtConfig, resolveReceiptSignatureTier } from "./gxt-config.js";
import { resolvePlannerEmails } from "./planner-identity.js";
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
