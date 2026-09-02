import type { ParsedMission } from "./types.js";
import type { VerifyFinding } from "./verify-finding.js";
import type { VerifyFailedPayload } from "./verify-payload.js";
import {
  clearRemediationSnapshot,
  readRemediationSnapshot,
  writeRemediationSnapshot,
  type RemediationSnapshot,
  REMEDIATION_SCHEMA_VERSION,
} from "./context-feed-store.js";
import { writeGateLog } from "./gate-log-writer.js";
import { GXT_ERROR } from "./gxt-error-codes.js";
import {
  appendDigestToRing,
  computeFindingsDigest,
  digestRecurredInRing,
} from "./verify-finding-fingerprint.js";

const RECURRENCE_HINT =
  "Identical semantic findings recurred — stop the repair loop and escalate to Planner.";
const RECURRENCE_ACTION = "Escalate to Planner; do not retry until the failure class changes.";

/** Tombstone digest ring on verify PASS (best-effort). */
export function tombstoneRemediationSnapshot(root: string): void {
  try {
    clearRemediationSnapshot(root);
  } catch {
    // best-effort ring clear on PASS
  }
}

export function loadPriorDigestRing(root: string, msnId: string | undefined): string[] {
  if (!msnId) return [];
  const prior = readRemediationSnapshot(root);
  if (!prior || prior.msn_id !== msnId) return [];
  return prior.digest_ring ?? [];
}

export function applyFindingsRecurrence(
  payload: VerifyFailedPayload,
  findings: VerifyFinding[],
  priorRing: string[],
): { payload: VerifyFailedPayload; digestRing: string[]; recurred: boolean } {
  const digest = computeFindingsDigest(findings);
  const recurred = digestRecurredInRing(priorRing, digest);
  const digestRing = recurred ? priorRing : appendDigestToRing(priorRing, digest);

  if (!recurred) {
    return { payload: { ...payload, findings, findings_digest: digest }, digestRing, recurred: false };
  }

  return {
    payload: {
      ...payload,
      findings,
      findings_digest: digest,
      error_code: GXT_ERROR.FINDINGS_RECURRED,
      fix_hints: [...payload.fix_hints, RECURRENCE_HINT],
      next_actions: [...payload.next_actions, RECURRENCE_ACTION],
    },
    digestRing,
    recurred: true,
  };
}

export function buildCompactRemediationSnapshot(input: {
  payload: VerifyFailedPayload;
  meta: { mission_file_path?: string; msn_id?: string };
  findings: VerifyFinding[];
  findingsDigest: string;
  digestRing: string[];
  gateLogPath?: string;
}): RemediationSnapshot {
  return {
    schema_version: REMEDIATION_SCHEMA_VERSION,
    written_at: new Date().toISOString(),
    source: "gantry verify",
    phase: input.payload.phase,
    error_code: input.payload.error_code,
    message: input.payload.message,
    ...input.meta,
    fix_hints: input.payload.fix_hints,
    next_actions: input.payload.next_actions,
    ...(input.payload.failures ? { failures: input.payload.failures } : {}),
    findings: input.findings,
    findings_digest: input.findingsDigest,
    digest_ring: input.digestRing,
    ...(input.gateLogPath ? { gate_log_path: input.gateLogPath } : {}),
  };
}

function persistRemediationSnapshotBestEffort(root: string, snapshot: RemediationSnapshot): void {
  try {
    writeRemediationSnapshot(root, snapshot);
  } catch {
    // Best-effort feed — verify must not fail because remediation I/O failed.
  }
}

export function persistFailedVerifyRemediation(input: {
  root: string;
  mission: ParsedMission | null;
  missionRel: string | undefined;
  payload: VerifyFailedPayload;
  findings: VerifyFinding[];
}): VerifyFailedPayload {
  const { root, mission, missionRel, payload, findings } = input;
  const msnId = mission?.msnId ?? undefined;
  const priorRing = loadPriorDigestRing(root, msnId);
  const { payload: nextPayload, digestRing, recurred } = applyFindingsRecurrence(
    payload,
    findings,
    priorRing,
  );
  const digest = computeFindingsDigest(findings);
  const gateLogPath = writeGateLog(root, msnId, nextPayload.stdout, nextPayload.stderr);
  const meta = mission
    ? {
        mission_file_path: missionRel,
        ...(msnId ? { msn_id: msnId } : {}),
      }
    : missionRel
      ? { mission_file_path: missionRel }
      : {};
  persistRemediationSnapshotBestEffort(
    root,
    buildCompactRemediationSnapshot({
      payload: nextPayload,
      meta,
      findings,
      findingsDigest: digest,
      digestRing: recurred ? priorRing : digestRing,
      gateLogPath,
    }),
  );
  return nextPayload;
}
