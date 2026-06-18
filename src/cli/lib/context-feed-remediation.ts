import type { VerifyFailedPayload } from "./verify-payload.js";
import type { ParsedMission } from "./types.js";
import type { VerifyPhaseFailure } from "./verify-engine.js";
import { toPosixRel } from "./cli-io.js";
import {
  readRemediationSnapshot,
  writeRemediationSnapshot,
  type RemediationSnapshot,
} from "./context-feed-store.js";
import { verifyFailurePresentation } from "./verify-failure-format.js";
import type { VerifyOptions } from "./verify-engine.js";

export function remediationFromFailedPayload(
  root: string,
  mission: ParsedMission | null,
  missionArg: string | undefined,
  payload: VerifyFailedPayload,
): RemediationSnapshot {
  return {
    schema_version: 1,
    written_at: new Date().toISOString(),
    source: "gapman verify",
    phase: payload.phase,
    error_code: payload.error_code,
    message: payload.message,
    ...(mission ? { mission_file_path: toPosixRel(root, mission.rawPath) } : {}),
    ...(mission?.msnId ? { msn_id: mission.msnId } : {}),
    ...(missionArg && !mission ? { mission_file_path: missionArg } : {}),
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

export function remediationFromPhaseFailure(
  root: string,
  mission: ParsedMission,
  missionArg: string,
  options: VerifyOptions,
  failure: VerifyPhaseFailure,
): RemediationSnapshot {
  const presentation = verifyFailurePresentation({
    failure,
    missionArg,
    options,
    root,
    msnId: mission.msnId ?? undefined,
  });
  return {
    schema_version: 1,
    written_at: new Date().toISOString(),
    source: "gapman verify",
    phase: failure.phase,
    error_code: presentation.error_code,
    message: failure.message,
    mission_file_path: toPosixRel(root, mission.rawPath),
    ...(mission.msnId ? { msn_id: mission.msnId } : {}),
    fix_hints: presentation.fix_hints,
    next_actions: presentation.next_actions,
    ...(failure.phase === "gate"
      ? {
          gate: {
            ...(failure.gateStdout !== undefined ? { stdout: failure.gateStdout } : {}),
            ...(failure.gateStderr !== undefined ? { stderr: failure.gateStderr } : {}),
            ...(failure.gateExitCode !== undefined ? { exit_code: failure.gateExitCode } : {}),
          },
        }
      : {}),
    ...(failure.phase === "kpi"
      ? {
          failures: [failure.kpiReason ?? failure.message],
          kpi: {
            ...(failure.kpiMetric ? { metric: failure.kpiMetric } : {}),
            ...(failure.kpiOp ? { op: failure.kpiOp } : {}),
            ...(failure.kpiExpected !== undefined ? { expected: failure.kpiExpected } : {}),
            ...(failure.kpiActual !== undefined ? { actual: failure.kpiActual } : {}),
            ...(failure.kpiReportPath ? { report_path: failure.kpiReportPath } : {}),
          },
        }
      : {}),
    ...(failure.phase === "trace" && failure.traceReason
      ? { failures: [`DoD trace: ${failure.traceReason}`] }
      : {}),
  };
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
