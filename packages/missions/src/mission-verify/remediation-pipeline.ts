import fs from "node:fs";
import path from "node:path";
import { REL_NEXT_REMEDIATION } from "#core/constants.js";
import { GXT_ERROR } from "#core/error-codes.js";
import { writeJsonAtomicSync } from "../atomic-fs.js";
import { appendDigestToRing, computeFindingsDigest, digestRecurredInRing } from "./finding-fingerprint.js";
import type { VerifyFinding } from "./finding.js";
import type { VerifyFailedPayload } from "./payload.js";

const REMEDIATION_SCHEMA_VERSION = 2 as const;

/** `.gitagent/tmp/NEXT_REMEDIATION.json`: the compact re-entry packet of the last failed verify (ADR-0040). */
export interface RemediationSnapshot {
  schema_version: typeof REMEDIATION_SCHEMA_VERSION;
  written_at: string;
  source: "gantry verify";
  cleared?: true;
  phase: string;
  error_code: string;
  message: string;
  mission_file_path?: string;
  msn_id?: string;
  fix_hints: string[];
  next_actions: string[];
  failures?: string[];
  findings?: VerifyFinding[];
  findings_digest?: string;
  digest_ring?: string[];
  gate_log_path?: string;
}

const RECURRENCE_HINT =
  "Identical semantic findings recurred — stop the repair loop and escalate to Planner.";
const RECURRENCE_ACTION = "Escalate to Planner; do not retry until the failure class changes.";

function snapshotPath(root: string): string {
  return path.join(root, REL_NEXT_REMEDIATION);
}

/** The live snapshot, or null when absent, unreadable, tombstoned or of another schema. */
export function readRemediationSnapshot(root: string): RemediationSnapshot | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(snapshotPath(root), "utf8")) as RemediationSnapshot;
    return parsed.schema_version === REMEDIATION_SCHEMA_VERSION && parsed.cleared !== true ? parsed : null;
  } catch {
    return null;
  }
}

function writeBestEffort(root: string, snapshot: RemediationSnapshot): void {
  try {
    writeJsonAtomicSync(snapshotPath(root), snapshot);
  } catch {
    // Best-effort feed — verify must not fail because remediation I/O failed.
  }
}

/** Verify PASS: tombstone the feed and its digest ring by atomic swap (never unlink-only). */
export function clearRemediationSnapshot(root: string): void {
  writeBestEffort(root, {
    schema_version: REMEDIATION_SCHEMA_VERSION,
    written_at: new Date().toISOString(),
    source: "gantry verify",
    cleared: true,
    phase: "cleared",
    error_code: "GXT_REMEDIATION_CLEARED",
    message: "Remediation feed cleared",
    fix_hints: [],
    next_actions: [],
  });
}

/**
 * Write the feed for a failed run. A findings digest already in the mission's 4-slot ring trips the circuit breaker:
 * the failure becomes GXT_FINDINGS_RECURRED. Returns the payload as persisted, with its findings_digest.
 */
export function persistVerifyFailure(
  root: string,
  payload: VerifyFailedPayload,
  meta: { mission_file_path?: string; msn_id?: string },
  gateLogPath?: string,
): VerifyFailedPayload {
  const prior = meta.msn_id ? readRemediationSnapshot(root) : null;
  const ring = prior?.msn_id === meta.msn_id ? (prior?.digest_ring ?? []) : [];
  const digest = computeFindingsDigest(payload.findings);
  const recurred = digestRecurredInRing(ring, digest);
  const next: VerifyFailedPayload = recurred
    ? {
        ...payload,
        findings_digest: digest,
        error_code: GXT_ERROR.FINDINGS_RECURRED,
        fix_hints: [...payload.fix_hints, RECURRENCE_HINT],
        next_actions: [...payload.next_actions, RECURRENCE_ACTION],
      }
    : { ...payload, findings_digest: digest };
  writeBestEffort(root, {
    schema_version: REMEDIATION_SCHEMA_VERSION,
    written_at: new Date().toISOString(),
    source: "gantry verify",
    phase: next.phase,
    error_code: next.error_code,
    message: next.message,
    ...meta,
    fix_hints: next.fix_hints,
    next_actions: next.next_actions,
    ...(next.failures ? { failures: next.failures } : {}),
    findings: next.findings,
    findings_digest: digest,
    digest_ring: recurred ? ring : appendDigestToRing(ring, digest),
    ...(gateLogPath ? { gate_log_path: gateLogPath } : {}),
  });
  return next;
}
