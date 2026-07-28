import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { canonicalJson } from "./canonical-json.js";
import { logWarn } from "./cli-io.js";
import { CLI_NAME, REL_RECEIPTS_DIR } from "./constants.js";
import { GantryUserError } from "./errors.js";
import {
  listMsnSubjectCommits,
  type MsnCommitRow,
} from "./git-proof.js";
import { gitConfigGet, gitRevParse } from "./git.js";
import { loadGxtConfig, resolveReceiptSignatureTier } from "./gxt-config.js";
import { resolveOrgExportConfig } from "./org-export-config.js";
import { resolvePlannerEmails } from "./planner-identity.js";
import {
  pseudonymizeEmail,
  resolveAttestationAgent,
  resolveBranchHmac,
  resolveRepositoryHash,
  type AttestationAgentState,
  type AttestationHarnessMode,
  type BranchClass,
} from "./receipt-attribution.js";
import {
  canonicalReceiptUtf8,
  signReceiptMessage,
  unsignedReceiptPayload,
  verifyReceiptAgainstCanonical,
  type ReceiptSignature,
  type ReceiptSignatureVerifyStatus,
} from "./receipt-signing.js";
import type { ParsedMission } from "./types.js";
import { computeWorkingDigests } from "./working-digests.js";

export const ATTESTATION_RECEIPT_SCHEMA_VERSION = "0.2.0" as const;

export type AttestationVerifyStatus = "passed" | "failed" | "attest_only";

export interface PlannerStampReceipt {
  commit: string;
  author_email_hmac: string;
}

export interface AttestationReceipt {
  schema_version: typeof ATTESTATION_RECEIPT_SCHEMA_VERSION;
  org_id: string;
  pepper_version: number;
  repository_hash: string;
  branch_hmac: string;
  branch_class: BranchClass;
  msn_id: string;
  mission_sha256: string;
  manifest_sha256: string | null;
  target_architecture_sha256: string | null;
  config_sha256: string | null;
  git_head: string;
  git_tree_sha: string;
  agent: AttestationAgentState;
  planner_stamp: PlannerStampReceipt | null;
  signer_principal_hmac: string | null;
  verify_status: AttestationVerifyStatus;
  error_code?: string;
  issued_at: string;
  receipt_sha256: string;
  signature?: ReceiptSignature;
}

export interface BuildAttestationReceiptInput {
  root: string;
  mission: ParsedMission;
  missionArg: string;
  verifyStatus: AttestationVerifyStatus;
  errorCode?: string;
  sign?: boolean;
  harnessMode?: AttestationHarnessMode;
}

function sha256Bytes(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function isPlannerStamp(row: MsnCommitRow, plannerEmails: string[]): boolean {
  return plannerEmails.includes(row.authorEmail.trim().toLowerCase());
}

export function resolvePlannerStampForReceipt(
  root: string,
  msnId: string,
  orgPepper: string,
): PlannerStampReceipt | null {
  const plannerEmails = resolvePlannerEmails(root).emails;
  if (plannerEmails.length === 0) return null;
  const rows = listMsnSubjectCommits(root, msnId);
  const stamp = rows.find((row) => isPlannerStamp(row, plannerEmails));
  if (!stamp) return null;
  return {
    commit: stamp.hash,
    author_email_hmac: pseudonymizeEmail(stamp.authorEmail, {
      org_id: "",
      pepper: orgPepper,
      pepper_version: 1,
    }),
  };
}

export function computeReceiptSha256(
  payload: Omit<AttestationReceipt, "receipt_sha256" | "signature">,
): string {
  return crypto
    .createHash("sha256")
    .update(canonicalJson(unsignedReceiptPayload(payload)), "utf8")
    .digest("hex");
}

function resolveSignerPrincipalHmac(root: string, orgPepper: string): string | null {
  const email = gitConfigGet(root, "user.email");
  if (!email?.trim()) return null;
  return pseudonymizeEmail(email, { org_id: "", pepper: orgPepper, pepper_version: 1 });
}

export function buildAttestationReceipt(input: BuildAttestationReceiptInput): AttestationReceipt {
  const missionAbs = path.resolve(input.root, input.missionArg);
  const msnId = input.mission.msnId;
  if (!msnId) {
    throw new GantryUserError("INVALID_ARGUMENT", "mission is missing msn_id", undefined, 2);
  }

  const org = resolveOrgExportConfig(input.root);
  const digests = computeWorkingDigests(input.root);
  if (digests.manifest_sha256 === null) {
    throw new GantryUserError(
      "MANIFEST_MISSING",
      "attestation receipt requires .gitagent/foreman/MANIFEST.json",
      "run gantry init or restore MANIFEST.json",
      2,
    );
  }

  const branch = resolveBranchHmac(input.root, org);
  const gitTree = gitRevParse(input.root, "HEAD^{tree}");

  const base: Omit<AttestationReceipt, "receipt_sha256" | "signature"> = {
    schema_version: ATTESTATION_RECEIPT_SCHEMA_VERSION,
    org_id: org.org_id,
    pepper_version: org.pepper_version,
    repository_hash: resolveRepositoryHash(input.root, org),
    branch_hmac: branch.branch_hmac,
    branch_class: branch.branch_class,
    msn_id: msnId,
    mission_sha256: sha256Bytes(fs.readFileSync(missionAbs)),
    manifest_sha256: digests.manifest_sha256,
    target_architecture_sha256: digests.target_architecture_sha256,
    config_sha256: digests.config_sha256,
    git_head: gitRevParse(input.root, "HEAD") ?? "no-head",
    git_tree_sha: gitTree ?? "no-tree",
    agent: resolveAttestationAgent(input.harnessMode),
    planner_stamp: resolvePlannerStampForReceipt(input.root, msnId, org.pepper),
    signer_principal_hmac: resolveSignerPrincipalHmac(input.root, org.pepper),
    verify_status: input.verifyStatus,
    issued_at: new Date().toISOString(),
  };
  if (input.errorCode) {
    base.error_code = input.errorCode;
  }

  const receipt_sha256 = computeReceiptSha256(base);
  const receipt: AttestationReceipt = { ...base, receipt_sha256 };

  const config = loadGxtConfig(input.root);
  const tier = resolveReceiptSignatureTier(config);
  const shouldSign = input.sign === true || tier === "require" || tier === "warn";
  if (!shouldSign) return receipt;

  const canonicalUtf8 = canonicalReceiptUtf8(receipt);
  const signature = signReceiptMessage(input.root, canonicalUtf8, "canonical_json_utf8");
  if (!signature) {
    if (tier === "require") {
      throw new GantryUserError(
        "RECEIPT_SIGNATURE_REQUIRED",
        "receipt_signature=require but no local SSH/GPG signing key is configured",
        "configure user.signingkey and gpg.format, or pass receipt_signature off",
        2,
      );
    }
    if (tier === "warn") {
      logWarn(
        `${CLI_NAME} attest: receipt unsigned — no local SSH/GPG signing key is configured`,
      );
    }
    return receipt;
  }

  const verifyStatus = verifyReceiptAgainstCanonical(
    input.root,
    { ...receipt, signature },
    canonicalUtf8,
  );
  if (tier === "warn" && verifyStatus !== "good") {
    logWarn(`${CLI_NAME} attest: receipt signature verify_status=${verifyStatus}`);
  }
  return {
    ...receipt,
    signature: {
      ...signature,
      verify_status: verifyStatus,
    },
  };
}

export function defaultReceiptPath(root: string, msnId: string, receiptSha256: string): string {
  const suffix = receiptSha256.slice(0, 12);
  return path.join(root, REL_RECEIPTS_DIR, `${msnId}-${suffix}.json`);
}

export function writeAttestationReceipt(
  root: string,
  receipt: AttestationReceipt,
  outPath?: string,
): string {
  const target = outPath
    ? path.resolve(root, outPath)
    : defaultReceiptPath(root, receipt.msn_id, receipt.receipt_sha256);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return target;
}

export type { ReceiptSignatureVerifyStatus };
