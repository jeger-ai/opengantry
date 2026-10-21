import type { VerifyFailedPayload } from "./mission-verify/payload.js";
import type { ParsedMission } from "#core/mission-types.js";
import { toPosixRel } from "#core/posix-path.js";
import { writeRemediationSnapshot, type RemediationSnapshot } from "./context-feed-store.js";
import { writeGateLog } from "./gate-log-writer.js";
import {
  buildCompactRemediationSnapshot,
  loadPriorDigestRing,
  applyFindingsRecurrence,
} from "./mission-verify/remediation-pipeline.js";
import { computeFindingsDigest } from "./mission-verify/finding-fingerprint.js";

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

function remediationFromFailedPayload(
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

function persistRemediationSnapshot(root: string, snapshot: RemediationSnapshot): void {
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

