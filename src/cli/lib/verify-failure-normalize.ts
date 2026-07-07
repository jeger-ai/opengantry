import { GXT_ERROR, gxtCodeFromGapmanUserError } from "./gxt-error-codes.js";
import type { GxtErrorCode } from "./gxt-error-codes.js";
import { errorMessage, toPosixRel } from "./cli-io.js";
import { isGapmanUserError } from "./errors.js";
import type { ParsedMission } from "./types.js";
import type { VerifyOptions, VerifyPhaseFailure } from "./verify-engine.js";
import {
  buildVerifyHintContext,
  hintsForVerifyPhase,
  type AudienceTaggedStep,
} from "./verify-hints.js";
import {
  REMEDIATION_SCHEMA_VERSION,
  type RemediationSnapshot,
} from "./context-feed-store.js";
import {
  normalizeGatePhase,
  normalizeGitProofPhase,
  normalizeKpiPhase,
  normalizeTracePendingPhase,
  normalizeTracePhase,
} from "./verify-failure-normalize-phases.js";
import type { VerifyFailedPayload } from "./verify-payload-types.js";

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
      return normalizeGitProofPhase(base);
    case "gate":
      return normalizeGatePhase(base, failure);
    case "kpi":
      return normalizeKpiPhase(base, failure);
    case "trace_pending":
      return normalizeTracePendingPhase(base, failure);
    case "trace":
      return normalizeTracePhase(base, failure);
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
