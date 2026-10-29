import crypto from "node:crypto";
import { canonicalJson } from "#core/canonical-json.js";
import { LEDGER_GENESIS_HASH } from "#core/constants.js";
import type { MissionDependencySpec } from "#core/mission-types.js";

export const LEDGER_ENTRY_SCHEMA_VERSION = "1.0.0" as const;

export const LEDGER_ENTRY_KINDS = [
  "receipt",
  "verify_findings",
  "break_glass",
  "policy_pin",
  "dependency_check",
] as const;

export type LedgerEntryKind = (typeof LEDGER_ENTRY_KINDS)[number];

/**
 * A passing verify (ADR-0043, ADR-0061): digest-only, pointing at the committed run record when the mission has one.
 * Pre-4.0 entries carried other fields (receipt_sha256, envelope_sha, …); the chain hashes payloads as written, so they
 * still verify.
 */
export interface ReceiptLedgerPayload {
  verify_status?: string;
  run_record_sha256?: string;
  /** Pre-4.0: a signed attestation receipt (read by `depends_on` `require.signed`). */
  signed?: boolean;
  /** `gantry ledger append` without an envelope. */
  source?: string;
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
