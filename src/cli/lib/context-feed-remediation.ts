import type { VerifyFailedPayload } from "./verify-payload-types.js";
import type { ParsedMission } from "./types.js";
import type { VerifyPhaseFailure } from "./verify-engine.js";
import type { VerifyOptions } from "./verify-engine.js";
import { toPosixRel } from "./cli-io.js";
import {
  readRemediationSnapshot,
  writeRemediationSnapshot,
  type RemediationSnapshot,
} from "./context-feed-store.js";
import {
  normalizeFromFailedPayload,
  normalizeVerifyPhaseFailure,
  toRemediationSnapshot,
} from "./verify-failure-normalize.js";

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
  return toRemediationSnapshot(normalizeFromFailedPayload(payload, meta));
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
  return toRemediationSnapshot(normalized);
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

export { readRemediationSnapshot };
