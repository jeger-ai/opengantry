import type { VerifyFailedPayload } from "./verify-payload.js";
import type { ParsedMission } from "./types.js";
import type { VerifyPhaseFailure } from "./verify-failure.js";
import type { VerifyOptions } from "./verify-options.js";
import { toPosixRel } from "./cli-io.js";
import { writeRemediationSnapshot, type RemediationSnapshot } from "./context-feed-store.js";
import { writeGateLog } from "./gate-log-writer.js";
import {
  buildCompactRemediationSnapshot,
  loadPriorDigestRing,
  applyFindingsRecurrence,
} from "./verify-remediation-pipeline.js";
import { computeFindingsDigest } from "./verify-finding-fingerprint.js";
import { buildFindingsForFailure, toVerifyFailedPayload } from "./verify-payload.js";
import { normalizeVerifyPhaseFailure } from "./verify-failure-normalize.js";

function remediationFromPayload(
  root: string,
  payload: VerifyFailedPayload,
  meta: { mission_file_path?: string; msn_id?: string },
  findings = payload.findings,
): RemediationSnapshot {
  const msnId = meta.msn_id;
  const priorRing = loadPriorDigestRing(root, msnId);
  const { payload: nextPayload, digestRing } = applyFindingsRecurrence(
    payload,
    findings,
    priorRing,
  );
  const digest = computeFindingsDigest(findings);
  const gateLogPath = writeGateLog(root, msnId, nextPayload.stdout, nextPayload.stderr);
  return buildCompactRemediationSnapshot({
    payload: nextPayload,
    meta,
    findings,
    findingsDigest: digest,
    digestRing,
    gateLogPath,
  });
}

export function remediationFromFailedPayload(
  root: string,
  mission: ParsedMission | null,
  missionArg: string | undefined,
  payload: VerifyFailedPayload,
): RemediationSnapshot {
  const meta = mission
    ? {
        mission_file_path: toPosixRel(root, mission.rawPath),
        ...(mission.msnId ? { msn_id: mission.msnId } : {}),
      }
    : missionArg
      ? { mission_file_path: missionArg }
      : {};
  return remediationFromPayload(root, payload, meta);
}

export function remediationFromPhaseFailure(
  root: string,
  mission: ParsedMission,
  missionArg: string,
  options: VerifyOptions,
  failure: VerifyPhaseFailure,
): RemediationSnapshot {
  const normalized = normalizeVerifyPhaseFailure({
    failure,
    missionArg,
    options,
    root,
    msnId: mission.msnId ?? undefined,
    mission,
  });
  const findings = buildFindingsForFailure(root, normalized, failure);
  const payload = toVerifyFailedPayload(normalized, failure, findings);
  return remediationFromPayload(
    root,
    payload,
    {
      mission_file_path: missionArg,
      ...(mission.msnId ? { msn_id: mission.msnId } : {}),
    },
    findings,
  );
}

export function persistRemediationSnapshot(root: string, snapshot: RemediationSnapshot): void {
  try {
    writeRemediationSnapshot(root, snapshot);
  } catch {
    // Best-effort feed — verify must not fail because remediation I/O failed.
  }
}

export function persistRemediationFromFailedPayload(
  root: string,
  mission: ParsedMission | null,
  missionArg: string | undefined,
  payload: VerifyFailedPayload,
): void {
  persistRemediationSnapshot(root, remediationFromFailedPayload(root, mission, missionArg, payload));
}

export function persistRemediationFromPhaseFailure(
  root: string,
  mission: ParsedMission,
  missionArg: string,
  options: VerifyOptions,
  failure: VerifyPhaseFailure,
): void {
  persistRemediationSnapshot(
    root,
    remediationFromPhaseFailure(root, mission, missionArg, options, failure),
  );
}

export { readRemediationSnapshot } from "./context-feed-store.js";
