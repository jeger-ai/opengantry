import { runBreakGlassAuditFlow } from "./break-glass.js";
import { toPosixRel } from "./cli-io.js";
import type { Manifest, ParsedMission } from "./types.js";
import {
  evaluateVerifyPhases,
  type VerifyPhaseResult,
  type VerifyPhaseSuccess,
} from "./verify-engine.js";
import type { VerifyOptions } from "./verify-options.js";
import type { VerifyPhaseFailure, GateFailure } from "./verify-failure.js";
import {
  normalizeInitFailure,
  normalizeVerifyPhaseFailure,
  type NormalizedVerifyFailure,
} from "./verify-failure-normalize.js";
import type { GxtErrorCode } from "./gxt-error-codes.js";
import { kpiFindingsToAdvisoryVerifyFindings } from "./kpi-advisory-findings.js";
import { projectGateFindings } from "./verify-finding-gate-projector.js";
import {
  VERIFY_ENVELOPE_SCHEMA_VERSION,
  verifyFinding,
  type VerifyFinding,
  type VerifyFailedGate,
} from "./verify-finding.js";

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
  mission_source?: "flag" | "pin";
  receipt_path?: string;
  message?: string;
  audit_commit?: string;
  trace_warnings?: VerifyTraceWarningJson[];
  git_proof_warnings?: string[];
  kpi_warnings?: string[];
  findings?: VerifyFinding[];
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
  findings_digest?: string;
  mission_file_path?: string;
  mission_source?: "flag" | "pin";
  receipt_path?: string;
  stdout?: string;
  stderr?: string;
  failures?: string[];
}

export type VerifyResultPayload = VerifyPassedPayload | VerifyFailedPayload;

function buildGateFindings(root: string, failure: GateFailure, hint: string): VerifyFinding[] {
  const projected = projectGateFindings(root, failure, hint);
  const adapterFindings = failure.adapterFindings;
  const genericOnly =
    projected.length === 1 &&
    projected[0]!.resolution_hint === hint &&
    adapterFindings !== undefined &&
    adapterFindings.length > 0;
  return genericOnly ? adapterFindings : projected;
}

function findingsFromPhase(root: string, failure: VerifyPhaseFailure, hint: string): VerifyFinding[] | null {
  switch (failure.phase) {
    case "trace":
      return [
        verifyFinding("trace", hint, {
          offending_file: failure.executorLogPath,
          line: failure.declaredLine ?? 0,
        }),
      ];
    case "kpi":
      return [verifyFinding("kpi", hint, { offending_file: failure.kpiReportPath })];
    case "gate":
      return buildGateFindings(root, failure, hint);
    case "defensive":
      return [verifyFinding("defensive", failure.defensiveReason || hint)];
    case "git_proof":
      return [verifyFinding("git_proof", failure.gitProofMessage || hint)];
    case "policy":
    case "dependencies":
      return failure.findings?.length ? failure.findings : null;
    case "interrogation":
    case "trace_pending":
      return null;
    default: {
      const _exhaustive: never = failure;
      return _exhaustive;
    }
  }
}

export function buildFindingsForFailure(
  root: string,
  normalized: NormalizedVerifyFailure,
  failure?: VerifyPhaseFailure,
): VerifyFinding[] {
  const hint = normalized.fix_hints[0] ?? normalized.message;
  const phaseGate = (normalized.phase === "trace_pending" ? "trace" : normalized.phase) as VerifyFailedGate;
  const fromPhase = failure ? findingsFromPhase(root, failure, hint) : null;
  if (fromPhase) return fromPhase;
  if (normalized.failures && normalized.failures.length > 0) {
    return normalized.failures.map((f) => verifyFinding(phaseGate, f));
  }
  return [verifyFinding(phaseGate, hint)];
}

export function toVerifyFailedPayload(
  normalized: NormalizedVerifyFailure,
  failure: VerifyPhaseFailure | undefined,
  findings: VerifyFinding[],
): VerifyFailedPayload {
  return {
    status: "failed",
    phase: normalized.phase,
    message: normalized.message,
    error_code: normalized.error_code,
    fix_hints: normalized.fix_hints,
    next_actions: normalized.next_actions,
    exit_code: normalized.exit_code,
    envelope_schema_version: VERIFY_ENVELOPE_SCHEMA_VERSION,
    findings,
    ...(normalized.gate?.stdout !== undefined ? { stdout: normalized.gate.stdout } : {}),
    ...(normalized.gate?.stderr !== undefined ? { stderr: normalized.gate.stderr } : {}),
    ...(normalized.failures ? { failures: normalized.failures } : {}),
  };
}

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
    ...(result.kpiAdvisoryFindings && result.kpiAdvisoryFindings.length > 0
      ? { findings: kpiFindingsToAdvisoryVerifyFindings(result.kpiAdvisoryFindings) }
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
  const normalized = normalizeInitFailure(e);
  const findings = buildFindingsForFailure("", normalized);
  return toVerifyFailedPayload(normalized, undefined, findings);
}

export function buildVerifyResultPayloadFromPhaseResult(
  root: string,
  mission: ParsedMission,
  _options: VerifyOptions,
  result: VerifyPhaseResult,
): VerifyResultPayload {
  const missionRel = missionRelPath(root, mission);
  if (result.ok) {
    return successPayload(root, mission, result);
  }
  const normalized = normalizeVerifyPhaseFailure({
    failure: result,
    missionArg: missionRel,
    options: _options,
    root,
    msnId: mission.msnId ?? undefined,
    mission,
  });
  const findings = buildFindingsForFailure(root, normalized, result);
  return toVerifyFailedPayload(normalized, result, findings);
}

export async function buildVerifyResultPayload(
  root: string,
  manifest: Manifest,
  mission: ParsedMission,
  options: VerifyOptions,
): Promise<VerifyResultPayload> {
  try {
    const result = await evaluateVerifyPhases(root, mission, options, manifest);
    return buildVerifyResultPayloadFromPhaseResult(root, mission, options, result);
  } catch (e) {
    return initFailurePayload(e);
  }
}
