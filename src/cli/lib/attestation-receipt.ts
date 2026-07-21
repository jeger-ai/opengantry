import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { TARGET_ARCHITECTURE_FILENAME } from "./arch/cage/target-architecture.js";
import { canonicalJson } from "./canonical-json.js";
import { REL_MANIFEST, REL_RECEIPTS_DIR } from "./constants.js";
import { GantryUserError } from "./errors.js";
import {
  listMsnSubjectCommits,
  missionPathRepoRelative,
  type MsnCommitRow,
} from "./git-proof.js";
import { gitRevParse } from "./git.js";
import { loadGxtConfig, resolveReceiptSignatureTier } from "./gxt-config.js";
import { resolvePlannerEmails } from "./planner-identity.js";
import {
  signReceiptHash,
  verifyReceiptSignature,
  type ReceiptSignature,
  type ReceiptSignatureVerifyStatus,
} from "./receipt-signing.js";
import type { ParsedMission } from "./types.js";

export const ATTESTATION_RECEIPT_SCHEMA_VERSION = "0.1.0" as const;

export type AttestationVerifyStatus = "passed" | "failed" | "attest_only";

export interface PlannerStampReceipt {
  commit: string;
  subject: string;
  author_email: string;
}

export interface AttestationReceipt {
  schema_version: typeof ATTESTATION_RECEIPT_SCHEMA_VERSION;
  msn_id: string;
  mission_rel: string;
  mission_sha256: string;
  manifest_sha256: string;
  target_architecture_sha256: string | null;
  config_sha256: string | null;
  git_head: string;
  planner_stamp: PlannerStampReceipt | null;
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
}

function sha256Bytes(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sha256FileOrNull(absPath: string): string | null {
  if (!fs.existsSync(absPath)) return null;
  return sha256Bytes(fs.readFileSync(absPath));
}

function isPlannerStamp(row: MsnCommitRow, plannerEmails: string[]): boolean {
  return plannerEmails.includes(row.authorEmail.trim().toLowerCase());
}

export function resolvePlannerStampForReceipt(
  root: string,
  msnId: string,
): PlannerStampReceipt | null {
  const plannerEmails = resolvePlannerEmails(root).emails;
  if (plannerEmails.length === 0) return null;
  const rows = listMsnSubjectCommits(root, msnId);
  const stamp = rows.find((row) => isPlannerStamp(row, plannerEmails));
  if (!stamp) return null;
  return {
    commit: stamp.hash,
    subject: stamp.subject,
    author_email: stamp.authorEmail,
  };
}

function unsignedReceiptPayload(
  input: AttestationReceipt | Omit<AttestationReceipt, "receipt_sha256" | "signature">,
): Record<string, unknown> {
  const { receipt_sha256: _receiptSha, signature: _signature, ...rest } = input as AttestationReceipt;
  return { ...rest };
}

export function computeReceiptSha256(
  payload: Omit<AttestationReceipt, "receipt_sha256" | "signature">,
): string {
  return crypto.createHash("sha256").update(canonicalJson(unsignedReceiptPayload(payload)), "utf8").digest("hex");
}

export function buildAttestationReceipt(input: BuildAttestationReceiptInput): AttestationReceipt {
  const missionAbs = path.resolve(input.root, input.missionArg);
  const missionRel = missionPathRepoRelative(input.root, missionAbs);
  const msnId = input.mission.msnId;
  if (!msnId) {
    throw new GantryUserError("INVALID_ARGUMENT", "mission is missing msn_id", undefined, 2);
  }

  const base: Omit<AttestationReceipt, "receipt_sha256" | "signature"> = {
    schema_version: ATTESTATION_RECEIPT_SCHEMA_VERSION,
    msn_id: msnId,
    mission_rel: missionRel,
    mission_sha256: sha256Bytes(fs.readFileSync(missionAbs)),
    manifest_sha256: sha256FileOrNull(path.join(input.root, REL_MANIFEST)) ?? "",
    target_architecture_sha256: sha256FileOrNull(path.join(input.root, TARGET_ARCHITECTURE_FILENAME)),
    config_sha256: sha256FileOrNull(path.join(input.root, ".gitagent", "config.json")),
    git_head: gitRevParse(input.root, "HEAD") ?? "no-head",
    planner_stamp: resolvePlannerStampForReceipt(input.root, msnId),
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

  const signature = signReceiptHash(input.root, receipt_sha256);
  if (!signature) {
    if (tier === "require") {
      throw new GantryUserError(
        "RECEIPT_SIGNATURE_REQUIRED",
        "receipt_signature=require but no local SSH/GPG signing key is configured",
        "configure user.signingkey and gpg.format, or pass receipt_signature off",
        2,
      );
    }
    return receipt;
  }

  const verifyStatus = verifyReceiptSignature(input.root, receipt_sha256, signature);
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

export function receiptSignatureIsGood(signature?: ReceiptSignature): boolean {
  return signature?.verify_status === "good";
}

export type { ReceiptSignatureVerifyStatus };
