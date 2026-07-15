import type { VerifyFailedPayload } from "./verify-payload.js";
import type { ParsedMission } from "./types.js";
import type { VerifyPhaseFailure } from "./verify-failure.js";
import type { VerifyOptions } from "./verify-options.js";
import { toPosixRel } from "./cli-io.js";
import {
  readRemediationSnapshot,
  writeRemediationSnapshot,
  REMEDIATION_SCHEMA_VERSION,
  type RemediationSnapshot,
} from "./context-feed-store.js";
import { normalizeVerifyPhaseFailure, toRemediationSnapshot } from "./verify-failure-normalize.js";

function remediationSnapshotFromFailedPayload(
  payload: VerifyFailedPayload,
  meta: { mission_file_path?: string; msn_id?: string },
): RemediationSnapshot {
  return {
    schema_version: REMEDIATION_SCHEMA_VERSION,
    written_at: new Date().toISOString(),
    source: "gantry verify",
    phase: payload.phase,
    error_code: payload.error_code,
    message: payload.message,
    ...meta,
    fix_hints: payload.fix_hints,
    next_actions: payload.next_actions,
    ...(payload.failures ? { failures: payload.failures } : {}),
    ...(payload.stdout !== undefined || payload.stderr !== undefined
      ? {
          gate: {
            ...(payload.stdout !== undefined ? { stdout: payload.stdout } : {}),
            ...(payload.stderr !== undefined ? { stderr: payload.stderr } : {}),
          },
        }
      : {}),
  };
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
  return remediationSnapshotFromFailedPayload(payload, meta);
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
