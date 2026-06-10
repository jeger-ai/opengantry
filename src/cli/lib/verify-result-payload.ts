import { runBreakGlassAuditFlow } from "./break-glass-flow.js";
import type { GxtErrorCode } from "./gxt-error-codes.js";
import { GXT_ERROR, gxtCodeFromGapmanUserError } from "./gxt-error-codes.js";
import { assertMissionGatePresent, parseMissionFile } from "./mission-parser.js";
import type { Manifest, ParsedMission } from "./types.js";
import { isGapmanUserError } from "./user-error.js";
import {
  evaluateVerifyPhases,
  type VerifyPhaseFailure,
  type VerifyPhaseResult,
  type VerifyPhaseSuccess,
} from "./verify-engine.js";
import { verifyFailurePresentation } from "./verify-failure-presentation.js";
import type { VerifyOptions } from "./verify-types.js";
import { toPosixRel, errorMessage } from "./cli-io.js";
import { loadWorkspace } from "./workspace.js";

export interface VerifyTraceWarningJson {
  dod_id: string;
  declared_line: number;
  found_line: number;
  auto_resolved?: boolean;
}

export interface VerifyPassedPayload {
  status: "passed";
  phase: "full" | "pre_push_stub" | "break_glass";
  exit_code: 0;
  msn_id?: string;
  mission_file_path?: string;
  message?: string;
  audit_commit?: string;
  trace_warnings?: VerifyTraceWarningJson[];
  trace_evidence_skipped_uncommitted?: number;
}

export interface VerifyFailedPayload {
  status: "failed";
  phase: string;
  message: string;
  error_code: GxtErrorCode;
  fix_hints: string[];
  next_actions: string[];
  exit_code: number;
  stdout?: string;
  stderr?: string;
  failures?: string[];
}

export type VerifyResultPayload = VerifyPassedPayload | VerifyFailedPayload;

function missionRelPath(root: string, mission: ParsedMission): string {
  return toPosixRel(root, mission.rawPath);
}

function traceWarningsJson(result: VerifyPhaseSuccess): VerifyTraceWarningJson[] | undefined {
  if (result.traceWarnings.length === 0) return undefined;
  return result.traceWarnings.map((w) => ({
    dod_id: w.row.dodId,
    declared_line: w.declaredLine,
    found_line: w.foundLine,
    ...(w.autoResolved ? { auto_resolved: true } : {}),
  }));
}

function successPayload(
  root: string,
  mission: ParsedMission,
  result: VerifyPhaseSuccess,
): VerifyPassedPayload {
  if (result.outcome === "pre_push_stub") {
    return {
      status: "passed",
      phase: "pre_push_stub",
      exit_code: 0,
      message: "Legislative stub OK (git-proof passed).",
      msn_id: result.proofMsnId,
    };
  }
  const traceWarnings = traceWarningsJson(result);
  return {
    status: "passed",
    phase: "full",
    exit_code: 0,
    msn_id: mission.msnId ?? undefined,
    mission_file_path: missionRelPath(root, mission),
    ...(traceWarnings ? { trace_warnings: traceWarnings } : {}),
    ...(result.traceEvidenceSkippedUncommitted !== undefined
      ? { trace_evidence_skipped_uncommitted: result.traceEvidenceSkippedUncommitted }
      : {}),
  };
}

/** Break-glass audit → structured pass/fail payload (no logging). */
export function buildBreakGlassPayload(
  root: string,
  mission: ParsedMission,
  options: VerifyOptions,
): VerifyResultPayload {
  const outcome = runBreakGlassAuditFlow(root, mission, options);
  if (outcome.kind === "fail") {
    return initFailurePayload(outcome.error);
  }
  return {
    status: "passed",
    phase: "break_glass",
    exit_code: 0,
    msn_id: outcome.msnId,
    mission_file_path: outcome.missionRel,
    message: outcome.reason,
    audit_commit: outcome.commitSha,
  };
}

function failureFromPhase(
  failure: VerifyPhaseFailure,
  missionRel: string,
  options: VerifyOptions,
  root: string,
  msnId?: string,
): VerifyFailedPayload {
  const presentation = verifyFailurePresentation({
    failure,
    missionArg: missionRel,
    options,
    root,
    msnId,
  });

  const base: VerifyFailedPayload = {
    status: "failed",
    phase: failure.phase,
    message: failure.message,
    error_code: presentation.error_code,
    fix_hints: presentation.fix_hints,
    next_actions: presentation.next_actions,
    exit_code: presentation.exit_code,
  };

  if (failure.phase === "gate") {
    return {
      ...base,
      ...(failure.gateStdout !== undefined ? { stdout: failure.gateStdout } : {}),
      ...(failure.gateStderr !== undefined ? { stderr: failure.gateStderr } : {}),
    };
  }
  if (failure.phase === "trace" && failure.traceReason) {
    return { ...base, failures: [`DoD trace: ${failure.traceReason}`] };
  }
  return base;
}

export function initFailurePayload(e: unknown): VerifyFailedPayload {
  if (isGapmanUserError(e)) {
    const errorCode = gxtCodeFromGapmanUserError(e.code);
    return {
      status: "failed",
      phase: "init",
      message: e.message,
      error_code: errorCode,
      fix_hints: e.hint ? [e.hint] : [],
      next_actions: [],
      exit_code: e.exitCode,
    };
  }
  const message = errorMessage(e);
  return {
    status: "failed",
    phase: "init",
    message,
    error_code: GXT_ERROR.PARSE_ERROR,
    fix_hints: [],
    next_actions: [],
    exit_code: 1,
  };
}

/** Map a pre-computed phase result → structured payload (no logging or re-evaluation). */
export function buildVerifyResultPayloadFromPhaseResult(
  root: string,
  mission: ParsedMission,
  missionArg: string,
  options: VerifyOptions,
  _manifest: Manifest,
  result: VerifyPhaseResult,
): VerifyResultPayload {
  const missionRel = missionRelPath(root, mission);
  const msnId = mission.msnId ?? undefined;
  if (result.ok) {
    return successPayload(root, mission, result);
  }
  return failureFromPhase(result, missionRel, options, root, msnId);
}

/** Phase evaluation → structured payload (no logging or process exit). */
export function buildVerifyResultPayload(
  root: string,
  manifest: Manifest,
  mission: ParsedMission,
  missionArg: string,
  options: VerifyOptions,
): VerifyResultPayload {
  const result = evaluateVerifyPhases(root, mission, options, manifest);
  return buildVerifyResultPayloadFromPhaseResult(
    root,
    mission,
    missionArg,
    options,
    manifest,
    result,
  );
}

/** Load workspace, parse mission, assert gate — flat init failures on error. */
export function buildVerifyResultPayloadFromOptions(options: VerifyOptions): VerifyResultPayload {
  try {
    const { root, manifest } = loadWorkspace();
    const mission = parseMissionFile(root, options.mission);
    assertMissionGatePresent(mission);
    return buildVerifyResultPayload(root, manifest, mission, options.mission, options);
  } catch (e) {
    return initFailurePayload(e);
  }
}
