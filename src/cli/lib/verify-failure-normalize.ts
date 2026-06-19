import { CLI_NAME } from "./constants.js";
import type { GxtErrorCode } from "./gxt-error-codes.js";
import { GXT_ERROR, gxtCodeFromGapmanUserError } from "./gxt-error-codes.js";
import { toPosixRel } from "./cli-io.js";
import { errorMessage } from "./cli-io.js";
import { isGapmanUserError } from "./errors.js";
import type { ParsedMission } from "./types.js";
import type { VerifyOptions, VerifyPhaseFailure } from "./verify-engine.js";
import {
  buildVerifyHintContext,
  hintsForVerifyPhase,
  type AudienceTaggedStep,
} from "./verify-hints.js";
import type { VerifyFailurePresentation } from "./verify-failure-presentation-types.js";
import type { VerifyFailedPayload } from "./verify-payload-types.js";
import {
  REMEDIATION_SCHEMA_VERSION,
  type RemediationSnapshot,
} from "./context-feed-store.js";

/** Canonical verify-failure contract — single mapping for all sinks. */
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
  stdout?: string;
  stderr?: string;
  failures?: string[];
  gate?: RemediationSnapshot["gate"];
  kpi?: RemediationSnapshot["kpi"];
  presentation_gate?: { stdout?: string; stderr?: string; exitCode?: number };
  trace?: { failures?: string[] };
  mission_file_path?: string;
  msn_id?: string;
}

export interface NormalizePhaseFailureInput {
  failure: VerifyPhaseFailure;
  missionArg: string;
  options: Pick<VerifyOptions, "strictTrace" | "audience">;
  root?: string;
  msnId?: string;
  mission?: ParsedMission | null;
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
  const { failure, missionArg, root, msnId, options, mission } = input;
  const remediation = hintsForVerifyPhase(
    failure.phase,
    buildVerifyHintContext(failure, missionArg, options, root, msnId),
  );
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
      return {
        ...base,
        headline: failure.message,
        detail_lines: [],
      };
    case "gate":
      return {
        ...base,
        headline: "verify: GATE FAILED",
        detail_lines: [
          ...(failure.gateStdout !== undefined ? [`--- stdout ---\n${failure.gateStdout}`] : []),
          ...(failure.gateStderr !== undefined ? [`--- stderr ---\n${failure.gateStderr}`] : []),
          ...(failure.gateExitCode !== undefined ? [`exit code: ${String(failure.gateExitCode)}`] : []),
        ],
        stdout: failure.gateStdout,
        stderr: failure.gateStderr,
        gate: {
          ...(failure.gateStdout !== undefined ? { stdout: failure.gateStdout } : {}),
          ...(failure.gateStderr !== undefined ? { stderr: failure.gateStderr } : {}),
          ...(failure.gateExitCode !== undefined ? { exit_code: failure.gateExitCode } : {}),
        },
        presentation_gate: {
          stdout: failure.gateStdout,
          stderr: failure.gateStderr,
          exitCode: failure.gateExitCode,
        },
      };
    case "kpi":
      return {
        ...base,
        headline: "verify: KPI GATE FAILED",
        detail_lines: [
          failure.kpiReason ?? failure.message,
          ...(failure.kpiMetric
            ? [`metric: ${failure.kpiMetric} ${failure.kpiOp ?? ""} ${String(failure.kpiExpected ?? "")} (actual: ${String(failure.kpiActual ?? "missing")})`]
            : []),
          ...(failure.kpiReportPath ? [`report: ${failure.kpiReportPath}`] : []),
        ],
        failures: [failure.kpiReason ?? failure.message],
        kpi: {
          ...(failure.kpiMetric ? { metric: failure.kpiMetric } : {}),
          ...(failure.kpiOp ? { op: failure.kpiOp } : {}),
          ...(failure.kpiExpected !== undefined ? { expected: failure.kpiExpected } : {}),
          ...(failure.kpiActual !== undefined ? { actual: failure.kpiActual } : {}),
          ...(failure.kpiReportPath ? { report_path: failure.kpiReportPath } : {}),
        },
      };
    case "trace_pending":
      return {
        ...base,
        headline: `${CLI_NAME} verify: legislative stub complete (git-proof OK) — worker must execute, append ${failure.workerLogPath}, set trace row PASS, then re-verify`,
        detail_lines: [],
      };
    case "trace":
      return {
        ...base,
        headline: "verify: TRACE MAPPING FAILED (Evidence Tampering / missing evidence)",
        detail_lines: [`DoD trace failure: ${failure.traceReason ?? failure.message}`],
        ...(failure.traceReason
          ? {
              failures: [`DoD trace: ${failure.traceReason}`],
              trace: { failures: [`DoD trace: ${failure.traceReason}`] },
            }
          : {}),
      };
    default: {
      const _exhaustive: never = failure.phase;
      return _exhaustive;
    }
  }
}

/** Map init/pre-phase errors to canonical contract. */
export function normalizeInitFailure(error: unknown): NormalizedVerifyFailure {
  if (isGapmanUserError(error)) {
    const errorCode = gxtCodeFromGapmanUserError(error.code);
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

export function toVerifyFailedPayload(normalized: NormalizedVerifyFailure): VerifyFailedPayload {
  return {
    status: "failed",
    phase: normalized.phase,
    message: normalized.message,
    error_code: normalized.error_code,
    fix_hints: normalized.fix_hints,
    next_actions: normalized.next_actions,
    exit_code: normalized.exit_code,
    ...(normalized.stdout !== undefined ? { stdout: normalized.stdout } : {}),
    ...(normalized.stderr !== undefined ? { stderr: normalized.stderr } : {}),
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
    ...(normalized.presentation_gate ? { gate: normalized.presentation_gate } : {}),
    ...(normalized.trace ? { trace: normalized.trace } : {}),
  };
}

export function toRemediationSnapshot(normalized: NormalizedVerifyFailure): RemediationSnapshot {
  return {
    schema_version: REMEDIATION_SCHEMA_VERSION,
    written_at: new Date().toISOString(),
    source: "gapman verify",
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

/** Project an existing JSON failure payload into remediation snapshot (init / replay paths). */
export function normalizeFromFailedPayload(
  payload: VerifyFailedPayload,
  meta: { mission_file_path?: string; msn_id?: string } = {},
): NormalizedVerifyFailure {
  return {
    phase: payload.phase,
    message: payload.message,
    exit_code: payload.exit_code,
    error_code: payload.error_code,
    fix_hints: payload.fix_hints,
    next_actions: payload.next_actions,
    headline: payload.message,
    detail_lines: [],
    ...(payload.stdout !== undefined ? { stdout: payload.stdout } : {}),
    ...(payload.stderr !== undefined ? { stderr: payload.stderr } : {}),
    ...(payload.failures ? { failures: payload.failures } : {}),
    ...(payload.stdout !== undefined || payload.stderr !== undefined
      ? {
          gate: {
            ...(payload.stdout !== undefined ? { stdout: payload.stdout } : {}),
            ...(payload.stderr !== undefined ? { stderr: payload.stderr } : {}),
          },
        }
      : {}),
    ...meta,
  };
}
