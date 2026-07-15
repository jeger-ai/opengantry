import { GXT_ERROR, gxtCodeFromGantryUserError } from "./gxt-error-codes.js";
import type { GxtErrorCode } from "./gxt-error-codes.js";
import { errorMessage, toPosixRel } from "./cli-io.js";
import { isGantryUserError } from "./errors.js";
import type { ParsedMission } from "./types.js";
import type { VerifyOptions, VerifyPhaseFailure } from "./verify-engine.js";
import { CLI_NAME } from "./constants.js";
import { hintsForVerifyPhase, type AudienceTaggedStep } from "./verify-hints.js";
import {
  REMEDIATION_SCHEMA_VERSION,
  type RemediationSnapshot,
} from "./context-feed-store.js";
import type {
  DefensiveFailure,
  GateFailure,
  KpiFailure,
  TraceFailure,
  TracePendingFailure,
} from "./verify-engine.js";
import type { VerifyFailedPayload } from "./verify-payload.js";
import { VERIFY_ENVELOPE_SCHEMA_VERSION, verifyFinding } from "./verify-finding.js";

/** Canonical verify-failure contract — single mapping for all sinks.
 * Gate output lives in the single `gate` field; sink projections rename at their boundary. */
export interface NormalizedVerifyFailure {
  phase: string;
  message: string;
  exit_code: number;
  error_code: GxtErrorCode;
  fix_hints: string[];
  next_actions: string[];
  tagged_steps?: AudienceTaggedStep[];
  headline: string;
  detail_lines: string[];
  failures?: string[];
  gate?: RemediationSnapshot["gate"];
  kpi?: RemediationSnapshot["kpi"];
  trace?: { failures?: string[] };
  mission_file_path?: string;
  msn_id?: string;
}

export type NormalizedVerifyFailureBase = Pick<
  NormalizedVerifyFailure,
  | "phase"
  | "message"
  | "exit_code"
  | "error_code"
  | "fix_hints"
  | "next_actions"
  | "tagged_steps"
  | "mission_file_path"
  | "msn_id"
>;

export interface VerifyFailurePresentationInput {
  failure: VerifyPhaseFailure;
  missionArg: string;
  options: Pick<VerifyOptions, "strictTrace" | "audience">;
  root?: string;
  msnId?: string;
}

export interface VerifyFailurePresentation {
  error_code: GxtErrorCode;
  headline: string;
  detail_lines: string[];
  fix_hints: string[];
  next_actions: string[];
  tagged_steps?: AudienceTaggedStep[];
  exit_code: number;
  gate?: { stdout?: string; stderr?: string; exitCode?: number };
  trace?: { failures?: string[] };
}

export interface NormalizePhaseFailureInput {
  failure: VerifyPhaseFailure;
  missionArg: string;
  options: Pick<VerifyOptions, "strictTrace" | "audience">;
  root?: string;
  msnId?: string;
  mission?: ParsedMission | null;
}

function normalizeGitProofPhase(base: NormalizedVerifyFailureBase): NormalizedVerifyFailure {
  return { ...base, headline: base.message, detail_lines: [] };
}

function normalizeGatePhase(
  base: NormalizedVerifyFailureBase,
  failure: GateFailure,
): NormalizedVerifyFailure {
  return {
    ...base,
    headline: "verify: GATE FAILED",
    detail_lines: [
      ...(failure.gateStdout !== undefined ? [`--- stdout ---\n${failure.gateStdout}`] : []),
      ...(failure.gateStderr !== undefined ? [`--- stderr ---\n${failure.gateStderr}`] : []),
      ...(failure.gateExitCode !== undefined ? [`exit code: ${String(failure.gateExitCode)}`] : []),
    ],
    gate: {
      ...(failure.gateStdout !== undefined ? { stdout: failure.gateStdout } : {}),
      ...(failure.gateStderr !== undefined ? { stderr: failure.gateStderr } : {}),
      ...(failure.gateExitCode !== undefined ? { exit_code: failure.gateExitCode } : {}),
    },
  };
}

function normalizeDefensivePhase(
  base: NormalizedVerifyFailureBase,
  failure: DefensiveFailure,
): NormalizedVerifyFailure {
  const reason = failure.defensiveReason;
  return {
    ...base,
    headline: "verify: DEFENSIVE GUARD FAILED",
    detail_lines: [
      reason,
      ...(failure.defensiveNetLoc !== undefined
        ? [`net_loc: ${String(failure.defensiveNetLoc)} (max: ${String(failure.defensiveMaxNetLoc ?? "?")})`]
        : []),
    ],
    failures: [reason],
  };
}

function normalizeKpiPhase(
  base: NormalizedVerifyFailureBase,
  failure: KpiFailure,
): NormalizedVerifyFailure {
  const reason = failure.kpiReason;
  return {
    ...base,
    headline: "verify: KPI GATE FAILED",
    detail_lines: [
      reason,
      ...(failure.kpiMetric
        ? [`metric: ${failure.kpiMetric} ${failure.kpiOp ?? ""} ${String(failure.kpiExpected ?? "")} (actual: ${String(failure.kpiActual ?? "missing")})`]
        : []),
      `report: ${failure.kpiReportPath}`,
    ],
    failures: [reason],
    kpi: {
      ...(failure.kpiMetric ? { metric: failure.kpiMetric } : {}),
      ...(failure.kpiOp ? { op: failure.kpiOp } : {}),
      ...(failure.kpiExpected !== undefined ? { expected: failure.kpiExpected } : {}),
      ...(failure.kpiActual !== undefined ? { actual: failure.kpiActual } : {}),
      report_path: failure.kpiReportPath,
    },
  };
}

function normalizeTracePendingPhase(
  base: NormalizedVerifyFailureBase,
  failure: TracePendingFailure,
): NormalizedVerifyFailure {
  return {
    ...base,
    headline: `${CLI_NAME} verify: legislative stub complete (git-proof OK) — executor must execute, append ${failure.executorLogPath}, set trace row PASS, then re-verify`,
    detail_lines: [],
  };
}

function normalizeTracePhase(
  base: NormalizedVerifyFailureBase,
  failure: TraceFailure,
): NormalizedVerifyFailure {
  return {
    ...base,
    headline: "verify: TRACE MAPPING FAILED (Evidence Tampering / missing evidence)",
    detail_lines: [`DoD trace failure: ${failure.traceReason}`],
    failures: [`DoD trace: ${failure.traceReason}`],
    trace: { failures: [`DoD trace: ${failure.traceReason}`] },
  };
}

function remediationMeta(
  root: string | undefined,
  mission: ParsedMission | null | undefined,
  missionArg: string,
  msnId: string | undefined,
): Pick<NormalizedVerifyFailure, "mission_file_path" | "msn_id"> {
  if (mission) {
    return {
      mission_file_path: toPosixRel(root ?? process.cwd(), mission.rawPath),
      ...(mission.msnId ? { msn_id: mission.msnId } : {}),
    };
  }
  if (missionArg) {
    return { mission_file_path: missionArg, ...(msnId ? { msn_id: msnId } : {}) };
  }
  return {};
}

/** Map engine phase failure to canonical contract (hints + phase artifacts in one switch). */
export function normalizeVerifyPhaseFailure(input: NormalizePhaseFailureInput): NormalizedVerifyFailure {
  const { failure, missionArg, root, msnId, mission } = input;
  const remediation = hintsForVerifyPhase(failure, { missionPath: missionArg, root, msnId });
  const base = {
    phase: failure.phase,
    message: failure.message,
    exit_code: failure.exitCode,
    error_code: remediation.error_code,
    fix_hints: remediation.fix_hints,
    next_actions: remediation.next_actions,
    tagged_steps: remediation.tagged_steps,
    ...remediationMeta(root, mission ?? null, missionArg, msnId),
  };

  switch (failure.phase) {
    case "git_proof":
      return normalizeGitProofPhase(base);
    case "gate":
      return normalizeGatePhase(base, failure);
    case "defensive":
      return normalizeDefensivePhase(base, failure);
    case "kpi":
      return normalizeKpiPhase(base, failure);
    case "trace_pending":
      return normalizeTracePendingPhase(base, failure);
    case "trace":
      return normalizeTracePhase(base, failure);
    default: {
      const _exhaustive: never = failure;
      return _exhaustive;
    }
  }
}

/** Map init/pre-phase errors to canonical contract. */
export function normalizeInitFailure(error: unknown): NormalizedVerifyFailure {
  if (isGantryUserError(error)) {
    const errorCode = gxtCodeFromGantryUserError(error.code);
    return {
      phase: "init",
      message: error.message,
      exit_code: error.exitCode,
      error_code: errorCode,
      fix_hints: error.hint ? [error.hint] : [],
      next_actions: [],
      headline: error.message,
      detail_lines: [],
    };
  }
  const message = errorMessage(error);
  return {
    phase: "init",
    message,
    exit_code: 1,
    error_code: GXT_ERROR.PARSE_ERROR,
    fix_hints: [],
    next_actions: [],
    headline: message,
    detail_lines: [],
  };
}

export function buildFindingsForFailure(
  normalized: NormalizedVerifyFailure,
  failure?: VerifyPhaseFailure,
): import("./verify-finding.js").VerifyFinding[] {
  const hint = normalized.fix_hints[0] ?? normalized.message;
  const phaseGate = (normalized.phase === "trace_pending" ? "trace" : normalized.phase) as import("./verify-finding.js").VerifyFailedGate;

  if (failure?.phase === "trace") {
    return [
      verifyFinding("trace", hint, {
        offending_file: failure.executorLogPath,
        line: 0,
      }),
    ];
  }
  if (failure?.phase === "kpi") {
    return [
      verifyFinding("kpi", hint, {
        offending_file: failure.kpiReportPath,
      }),
    ];
  }
  if (failure?.phase === "gate") {
    return [verifyFinding("gate", hint)];
  }
  if (failure?.phase === "defensive") {
    return [verifyFinding("defensive", failure.defensiveReason || hint)];
  }
  if (failure?.phase === "git_proof") {
    return [verifyFinding("git_proof", failure.gitProofMessage || hint)];
  }

  if (normalized.failures && normalized.failures.length > 0) {
    return normalized.failures.map((f) => verifyFinding(phaseGate, f));
  }

  return [verifyFinding(phaseGate, hint)];
}

export function toVerifyFailedPayload(
  normalized: NormalizedVerifyFailure,
  failure?: import("./verify-engine.js").VerifyPhaseFailure,
): VerifyFailedPayload {
  const findings = buildFindingsForFailure(normalized, failure);
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

export function toFailurePresentation(normalized: NormalizedVerifyFailure): VerifyFailurePresentation {
  return {
    error_code: normalized.error_code,
    headline: normalized.headline,
    detail_lines: normalized.detail_lines,
    fix_hints: normalized.fix_hints,
    next_actions: normalized.next_actions,
    tagged_steps: normalized.tagged_steps,
    exit_code: normalized.exit_code,
    ...(normalized.gate
      ? {
          gate: {
            stdout: normalized.gate.stdout,
            stderr: normalized.gate.stderr,
            exitCode: normalized.gate.exit_code,
          },
        }
      : {}),
    ...(normalized.trace ? { trace: normalized.trace } : {}),
  };
}

export function toRemediationSnapshot(normalized: NormalizedVerifyFailure): RemediationSnapshot {
  return {
    schema_version: REMEDIATION_SCHEMA_VERSION,
    written_at: new Date().toISOString(),
    source: "gantry verify",
    phase: normalized.phase,
    error_code: normalized.error_code,
    message: normalized.message,
    ...(normalized.mission_file_path ? { mission_file_path: normalized.mission_file_path } : {}),
    ...(normalized.msn_id ? { msn_id: normalized.msn_id } : {}),
    fix_hints: normalized.fix_hints,
    next_actions: normalized.next_actions,
    ...(normalized.failures ? { failures: normalized.failures } : {}),
    ...(normalized.gate ? { gate: normalized.gate } : {}),
    ...(normalized.kpi ? { kpi: normalized.kpi } : {}),
  };
}
