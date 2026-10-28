import { runBreakGlassAuditFlow } from "../break-glass.js";
import { toPosixRel } from "#core/posix-path.js";
import type { Manifest } from "#core/manifest.js";
import type { ParsedMission } from "#core/mission-types.js";
import { GXT_ERROR, gxtCodeFromGantryUserError, type GxtErrorCode } from "#core/error-codes.js";
import { errorMessage, isGantryUserError } from "#core/user-error.js";
import { extractImportLayerGateReport } from "../repair.js";
import type { ExportFinding, JUnitCase } from "#verify/export.js";
import {
  evaluateVerifyPhases,
  verifyPhaseStatuses,
  type VerifyPhaseResult,
  type VerifyPhaseSuccess,
} from "./engine.js";
import type { VerifyEvaluation } from "./options.js";
import type { VerifyPhaseFailure, GateFailure } from "./failure.js";
import { hintsForVerifyPhase, type AudienceTaggedStep } from "./hints.js";
import {
  VERIFY_ENVELOPE_SCHEMA_VERSION,
  verifyFinding,
  type VerifyFinding,
} from "./finding.js";

interface VerifyTraceWarningJson {
  dod_id: string;
  declared_line: number;
  found_line: number;
  auto_resolved?: boolean;
}

interface VerifyPassedPayload {
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
  findings?: VerifyFinding[];
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
  /** The gate log this run wrote (repo-relative); the payload never carries the gate's output text. */
  gate_log_path?: string;
  failures?: string[];
}

export type VerifyResultPayload = VerifyPassedPayload | VerifyFailedPayload;

/** A failed phase in its final shape, built once per failure: the payload plus what only the human sinks print. */
export interface VerifyFailure {
  payload: VerifyFailedPayload;
  headline: string;
  detail_lines: string[];
  tagged_steps?: AudienceTaggedStep[];
}

/** Import-layer gate JSON becomes one finding per violation; other gate output has no structured findings. */
function importLayerFindings(failure: GateFailure): VerifyFinding[] | undefined {
  const report = extractImportLayerGateReport(failure.gateOutput ?? "", "");
  if (!report || report.ok !== false || report.violations.length === 0) return undefined;
  return report.violations.map((v) =>
    verifyFinding("gate", `${v.rule_id}: ${v.module_specifier}`, {
      offending_file: v.file,
      line: v.line,
      start_column: v.column,
      rule_id: v.rule_id,
    }),
  );
}

function phaseFindings(failure: VerifyPhaseFailure, hint: string): VerifyFinding[] | undefined {
  switch (failure.phase) {
    case "trace":
      return [verifyFinding("trace", hint, { offending_file: failure.executorLogPath, line: failure.declaredLine ?? 0 })];
    case "gate":
      if (failure.gateAdapter !== undefined && failure.gateAdapter !== "generic") {
        return failure.adapterFindings?.length ? failure.adapterFindings : undefined;
      }
      return importLayerFindings(failure) ?? failure.adapterFindings;
    case "git_proof":
      return [verifyFinding("git_proof", failure.message || hint)];
    case "run_record":
      return [verifyFinding("trace", failure.recordReason, failure.stalePaths?.[0] ? { offending_file: failure.stalePaths[0] } : {})];
    case "trace_pending":
      return undefined;
    default:
      return failure.findings?.length ? failure.findings : undefined;
  }
}

/** The one normalization of a phase failure: code, hints, findings and human text together. */
export function verifyFailure(root: string, mission: ParsedMission, failure: VerifyPhaseFailure): VerifyFailure {
  const said = hintsForVerifyPhase(failure, {
    missionPath: missionRelPath(root, mission),
    root,
    msnId: mission.msnId ?? undefined,
  });
  const hint = said.fix_hints[0] ?? failure.message;
  const gate = failure.phase === "trace_pending" || failure.phase === "run_record" ? "trace" : failure.phase;
  const findings =
    phaseFindings(failure, hint) ?? (said.failures?.length ? said.failures : [hint]).map((f) => verifyFinding(gate, f));
  const gateLogPath = failure.phase === "gate" ? failure.gateLogPath : undefined;
  return {
    payload: {
      status: "failed",
      phase: failure.phase,
      message: failure.message,
      error_code: said.error_code,
      fix_hints: said.fix_hints,
      next_actions: said.next_actions,
      exit_code: failure.exitCode,
      envelope_schema_version: VERIFY_ENVELOPE_SCHEMA_VERSION,
      findings,
      ...(gateLogPath !== undefined ? { gate_log_path: gateLogPath } : {}),
      ...(said.failures ? { failures: said.failures } : {}),
    },
    headline: said.headline,
    detail_lines: said.detail_lines,
    tagged_steps: said.tagged_steps,
  };
}

/** Init/pre-phase errors (mission load, receipt write) as a failed payload. */
export function initFailurePayload(e: unknown): VerifyFailedPayload {
  const userError = isGantryUserError(e) ? e : null;
  const message = userError ? userError.message : errorMessage(e);
  const fixHints = userError?.hint ? [userError.hint] : [];
  return {
    status: "failed",
    phase: "init",
    message,
    error_code: userError ? gxtCodeFromGantryUserError(userError.code) : GXT_ERROR.PARSE_ERROR,
    fix_hints: fixHints,
    next_actions: [],
    exit_code: userError ? userError.exitCode : 1,
    envelope_schema_version: VERIFY_ENVELOPE_SCHEMA_VERSION,
    findings: [verifyFinding("init", fixHints[0] ?? message)],
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
    ...(result.traceEvidenceSkippedUncommitted !== undefined
      ? { trace_evidence_skipped_uncommitted: result.traceEvidenceSkippedUncommitted }
      : {}),
  };
}

export function buildBreakGlassPayload(
  root: string,
  mission: ParsedMission,
  options: VerifyEvaluation,
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

export function buildVerifyResultPayloadFromPhaseResult(
  root: string,
  mission: ParsedMission,
  result: VerifyPhaseResult,
): VerifyResultPayload {
  return result.ok ? successPayload(root, mission, result) : verifyFailure(root, mission, result).payload;
}

export async function buildVerifyResultPayload(
  root: string,
  manifest: Manifest,
  mission: ParsedMission,
  options: VerifyEvaluation,
): Promise<VerifyResultPayload> {
  try {
    const result = await evaluateVerifyPhases(root, mission, options, manifest);
    return buildVerifyResultPayloadFromPhaseResult(root, mission, result);
  } catch (e) {
    return initFailurePayload(e);
  }
}

/** Concrete file for repository-wide results. Directories cannot carry a SARIF region. */
const GENERIC_SARIF_FILE = ".gitagent/foreman/MANIFEST.yaml";

function sarifRegion(f: VerifyFinding): Record<string, number> {
  const region: Record<string, number> = { startLine: f.line > 0 ? f.line : 1 };
  for (const [key, value] of Object.entries({ endLine: f.end_line, startColumn: f.start_column, endColumn: f.end_column })) {
    if (value !== undefined && value > 0) region[key] = value;
  }
  return region;
}

/**
 * The payload as the shared SARIF writer reads it: a failure's findings (one without a file points at the mission,
 * else the manifest; a directory has no region), or a pass's trace drift without a location.
 */
export function payloadExportFindings(payload: VerifyResultPayload, isDirectory: (uri: string) => boolean): ExportFinding[] {
  if (payload.status === "passed") {
    return (payload.trace_warnings ?? []).map((w) => ({
      ruleId: "GXT_TRACE_STALE",
      level: "warning",
      text: `DoD ${w.dod_id}: declared line ${String(w.declared_line)}, found ${String(w.found_line)}`,
    }));
  }
  const mission = payload.mission_file_path?.trim();
  const fallback = mission && !isDirectory(mission) ? mission : GENERIC_SARIF_FILE;
  return payload.findings.map((f) => {
    const uri = f.offending_file.trim() || fallback;
    const region = isDirectory(uri) ? {} : { region: sarifRegion(f) };
    return { ruleId: f.rule_id ?? f.failed_gate, level: f.severity, text: f.resolution_hint, uri, ...region, hint: f.resolution_hint };
  });
}

/** The JUnit cases of a run: one per verify phase, or one for the payload's phase when none ran (init, break-glass). */
export function payloadJUnitCases(payload: VerifyResultPayload, result?: VerifyPhaseResult): JUnitCase[] {
  const failed = payload.status === "failed";
  if (!result) {
    return [{ name: payload.phase, failure: failed ? [payload.message, ...(payload.failures ?? []), ...payload.fix_hints].join("\n") : undefined }];
  }
  return verifyPhaseStatuses(result).map(({ id, status }) => ({
    name: id,
    failure: status === "failed" ? (failed ? payload.message : "failed") : undefined,
    skipped: status === "skipped",
  }));
}
