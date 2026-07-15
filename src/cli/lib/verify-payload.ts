import { runBreakGlassAuditFlow } from "./break-glass.js";
import { toPosixRel } from "./cli-io.js";
import type { Manifest, ParsedMission } from "./types.js";
import {
  evaluateVerifyPhases,
  type VerifyOptions,
  type VerifyPhaseResult,
  type VerifyPhaseSuccess,
} from "./verify-engine.js";
import {
  normalizeInitFailure,
  normalizeVerifyPhaseFailure,
  toRemediationSnapshot,
  toVerifyFailedPayload,
} from "./verify-failure-normalize.js";
import { persistRemediationSnapshot } from "./context-feed-remediation.js";

import type { GxtErrorCode } from "./gxt-error-codes.js";
import type { VerifyFinding, VerifyFailedGate } from "./verify-finding.js";
import { VERIFY_ENVELOPE_SCHEMA_VERSION, verifyFinding } from "./verify-finding.js";

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
  git_proof_warnings?: string[];
  kpi_warnings?: string[];
  defensive_warnings?: string[];
  defensive_audits?: string[];
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
  envelope_schema_version: typeof VERIFY_ENVELOPE_SCHEMA_VERSION;
  findings: VerifyFinding[];
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
    ...(result.gitProofWarnings && result.gitProofWarnings.length > 0
      ? { git_proof_warnings: result.gitProofWarnings }
      : {}),
    ...(result.kpiWarnings && result.kpiWarnings.length > 0
      ? { kpi_warnings: result.kpiWarnings }
      : {}),
    ...(result.defensiveWarnings && result.defensiveWarnings.length > 0
      ? { defensive_warnings: result.defensiveWarnings }
      : {}),
    ...(result.defensiveAudits && result.defensiveAudits.length > 0
      ? { defensive_audits: result.defensiveAudits }
      : {}),
    ...(result.traceEvidenceSkippedUncommitted !== undefined
      ? { trace_evidence_skipped_uncommitted: result.traceEvidenceSkippedUncommitted }
      : {}),
  };
}

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

export function initFailurePayload(e: unknown): VerifyFailedPayload {
  return toVerifyFailedPayload(normalizeInitFailure(e));
}

export function buildVerifyResultPayloadFromPhaseResult(
  root: string,
  mission: ParsedMission,
  missionArg: string,
  options: VerifyOptions,
  _manifest: Manifest,
  result: VerifyPhaseResult,
): VerifyResultPayload {
  const missionRel = missionRelPath(root, mission);
  if (result.ok) {
    return successPayload(root, mission, result);
  }
  const normalized = normalizeVerifyPhaseFailure({
    failure: result,
    missionArg: missionRel,
    options,
    root,
    msnId: mission.msnId ?? undefined,
    mission,
  });
  const payload = toVerifyFailedPayload(normalized, result);
  persistRemediationSnapshot(root, toRemediationSnapshot(normalized));
  return payload;
}

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
