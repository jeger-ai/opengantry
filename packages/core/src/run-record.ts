/**
 * The run record (ADR-0052 A4, A5): machine-written evidence that a mission's checks ran on a given tree. Written by
 * `gantry verify --record` after a full pass on a clean, committed head; read by every later verify. A PASS binds to
 * the record, not to a quote an agent copied. Pure: the loader supplies the git facts.
 */
import { canonicalJson } from "./canonical-json.js";
import { createHash } from "node:crypto";

export const RUN_RECORD_SCHEMA = "opengantry.run-record.v1" as const;

export interface RunRecordCheck {
  name: string;
  command: string;
  exit: number | null;
  duration_ms: number;
  /** sha256 of the check's combined output; the output itself stays out of the record (digest-only). */
  output_sha256: string;
}

export interface RunRecord {
  schema: typeof RUN_RECORD_SCHEMA;
  kind: "verify";
  msn_id: string;
  /** Repo-relative mission path. */
  mission_path: string;
  /** Commit the checks ran on; the working tree was clean, so this names the tree exactly. */
  head: string;
  tree: string;
  /** sha256 of the canonical effective law (roots, forbidden zones, gate, contract digest) the checks enforced. */
  law_sha256: string;
  checks: RunRecordCheck[];
  status: "PASS";
  issued_at: string;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Digest of a record's bytes in canonical form (the ledger and receipts reference it). */
export function runRecordDigest(record: RunRecord): string {
  return sha256Hex(canonicalJson(record));
}

export type RunRecordFindingKind = "missing" | "mismatch" | "stale";

export interface RunRecordFinding {
  kind: RunRecordFindingKind;
  reason: string;
  stalePaths?: string[];
}

export interface RunRecordExpectation {
  msnId: string;
  missionPath: string;
  lawSha256: string;
  /** True when the record's head is an ancestor of (or equal to) HEAD. */
  headIsAncestor: boolean;
  /** Paths under the skill roots changed since the record's head (committed or working tree). */
  changedSinceHead: string[];
}

/** Judge a record against what the current verify expects. One finding at most, the first that applies. */
export function evaluateRunRecord(record: RunRecord | null, expect: RunRecordExpectation): RunRecordFinding | null {
  if (!record) return { kind: "missing", reason: `no run record for ${expect.msnId}` };
  if (record.schema !== RUN_RECORD_SCHEMA) return { kind: "mismatch", reason: `run record schema ${String(record.schema)} is not ${RUN_RECORD_SCHEMA}` };
  if (record.status !== "PASS") return { kind: "mismatch", reason: `run record status ${String(record.status)} is not PASS` };
  if (record.msn_id !== expect.msnId) return { kind: "mismatch", reason: `run record is for ${record.msn_id}, not ${expect.msnId}` };
  if (record.mission_path !== expect.missionPath) return { kind: "mismatch", reason: `run record names mission ${record.mission_path}, not ${expect.missionPath}` };
  if (record.law_sha256 !== expect.lawSha256) return { kind: "mismatch", reason: "the mission law changed since the record (roots, forbidden zones, gate or contract)" };
  if (!expect.headIsAncestor) return { kind: "mismatch", reason: `run record head ${record.head.slice(0, 12)} is not an ancestor of HEAD` };
  if (expect.changedSinceHead.length > 0) {
    const shown = expect.changedSinceHead.slice(0, 5);
    const suffix = expect.changedSinceHead.length > 5 ? ` (+${String(expect.changedSinceHead.length - 5)} more)` : "";
    return { kind: "stale", reason: `skill roots changed since the record at ${record.head.slice(0, 12)}: ${shown.join(", ")}${suffix}`, stalePaths: expect.changedSinceHead };
  }
  return null;
}
