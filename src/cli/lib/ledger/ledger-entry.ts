import crypto from "node:crypto";
import { canonicalJson } from "../canonical-json.js";
import { LEDGER_GENESIS_HASH } from "../constants.js";
import type { MissionDependencySpec } from "../types.js";

export const LEDGER_ENTRY_SCHEMA_VERSION = "1.0.0" as const;

export const LEDGER_ENTRY_KINDS = [
  "receipt",
  "verify_findings",
  "break_glass",
  "policy_pin",
  "dependency_check",
] as const;

export type LedgerEntryKind = (typeof LEDGER_ENTRY_KINDS)[number];

/** Digest-only receipt fields already allowed on the export path (ADR-0043). */
export interface ReceiptLedgerPayload {
  verify_status?: string;
  signed?: boolean;
  receipt_sha256?: string;
  source?: string;
  envelope_sha?: string;
  has_payload?: boolean;
}

export interface VerifyFindingsLedgerPayload {
  failed_gate: string;
  findings_digest?: string;
  fingerprints?: string[];
  message?: string;
}

export interface BreakGlassLedgerPayload {
  reason_sha256: string;
  error_code: string;
}

export interface PolicyPinLedgerPayload {
  policy_id: string;
  bundle_sha256: string;
  pinned_commit: string;
}

export interface DependencyCheckLedgerPayload {
  repo: string;
  msn_id: string;
  require?: MissionDependencySpec["require"];
  result: string;
}

export type LedgerPayload =
  | ReceiptLedgerPayload
  | VerifyFindingsLedgerPayload
  | BreakGlassLedgerPayload
  | PolicyPinLedgerPayload
  | DependencyCheckLedgerPayload;

export type LedgerPayloadFor<K extends LedgerEntryKind> = K extends "receipt"
  ? ReceiptLedgerPayload
  : K extends "verify_findings"
    ? VerifyFindingsLedgerPayload
    : K extends "break_glass"
      ? BreakGlassLedgerPayload
      : K extends "policy_pin"
        ? PolicyPinLedgerPayload
        : K extends "dependency_check"
          ? DependencyCheckLedgerPayload
          : never;

interface LedgerEntryBase {
  schema_version: typeof LEDGER_ENTRY_SCHEMA_VERSION;
  org_id: string;
  repository_hash: string;
  msn_id: string;
  git_head: string;
  payload_sha256: string;
  prev_entry_hash: string;
  issued_at: string;
}

export type LedgerEntry =
  | (LedgerEntryBase & { entry_kind: "receipt"; payload: ReceiptLedgerPayload })
  | (LedgerEntryBase & { entry_kind: "verify_findings"; payload: VerifyFindingsLedgerPayload })
  | (LedgerEntryBase & { entry_kind: "break_glass"; payload: BreakGlassLedgerPayload })
  | (LedgerEntryBase & { entry_kind: "policy_pin"; payload: PolicyPinLedgerPayload })
  | (LedgerEntryBase & { entry_kind: "dependency_check"; payload: DependencyCheckLedgerPayload });

export function sha256Utf8(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export function entryHash(entry: LedgerEntry): string {
  return sha256Utf8(canonicalJson(entry));
}

export function genesisPrevHash(): string {
  return LEDGER_GENESIS_HASH;
}

export function buildLedgerEntry<K extends LedgerEntryKind>(input: {
  kind: K;
  org_id: string;
  repository_hash: string;
  msn_id: string;
  git_head: string;
  payload: LedgerPayloadFor<K>;
  prev_entry_hash: string;
  issued_at?: string;
}): Extract<LedgerEntry, { entry_kind: K }> {
  const payload_sha256 = sha256Utf8(canonicalJson(input.payload));
  return {
    schema_version: LEDGER_ENTRY_SCHEMA_VERSION,
    entry_kind: input.kind,
    org_id: input.org_id,
    repository_hash: input.repository_hash,
    msn_id: input.msn_id,
    git_head: input.git_head,
    payload_sha256,
    payload: input.payload,
    prev_entry_hash: input.prev_entry_hash,
    issued_at: input.issued_at ?? new Date().toISOString(),
  } as Extract<LedgerEntry, { entry_kind: K }>;
}
