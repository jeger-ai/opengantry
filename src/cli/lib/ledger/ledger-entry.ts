import crypto from "node:crypto";
import { canonicalJson } from "../canonical-json.js";
import { LEDGER_GENESIS_HASH } from "../constants.js";

export const LEDGER_ENTRY_SCHEMA_VERSION = "1.0.0" as const;

export const LEDGER_ENTRY_KINDS = [
  "receipt",
  "verify_findings",
  "break_glass",
  "policy_pin",
  "dependency_check",
] as const;

export type LedgerEntryKind = (typeof LEDGER_ENTRY_KINDS)[number];

export interface LedgerEntry {
  schema_version: typeof LEDGER_ENTRY_SCHEMA_VERSION;
  entry_kind: LedgerEntryKind;
  org_id: string;
  repository_hash: string;
  msn_id: string;
  git_head: string;
  payload_sha256: string;
  payload: Record<string, unknown>;
  prev_entry_hash: string;
  issued_at: string;
}

export function sha256Utf8(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export function entryHash(entry: LedgerEntry): string {
  return sha256Utf8(canonicalJson(entry));
}

export function genesisPrevHash(): string {
  return LEDGER_GENESIS_HASH;
}

export function buildLedgerEntry(input: {
  kind: LedgerEntryKind;
  org_id: string;
  repository_hash: string;
  msn_id: string;
  git_head: string;
  payload: Record<string, unknown>;
  prev_entry_hash: string;
  issued_at?: string;
}): LedgerEntry {
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
  };
}
