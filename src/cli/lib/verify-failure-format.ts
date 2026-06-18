import { CLI_NAME } from "./constants.js";
import type { GxtErrorCode } from "./gxt-error-codes.js";
import type { VerifyOptions, VerifyPhaseFailure } from "./verify-engine.js";
import {
  buildVerifyHintContext,
  hintsForVerifyPhase,
  type AudienceTaggedStep,
} from "./verify-hints.js";

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

export function verifyFailurePresentation(
  input: VerifyFailurePresentationInput,
): VerifyFailurePresentation {
  const { failure, missionArg, root, msnId, options } = input;
  const remediation = hintsForVerifyPhase(
    failure.phase,
    buildVerifyHintContext(failure, missionArg, options, root, msnId),
  );
  const base = {
    error_code: remediation.error_code,
    fix_hints: remediation.fix_hints,
    next_actions: remediation.next_actions,
    tagged_steps: remediation.tagged_steps,
    exit_code: failure.exitCode,
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
        gate: {
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
        trace: failure.traceReason
          ? { failures: [`DoD trace: ${failure.traceReason}`] }
          : undefined,
      };
    default: {
      const _exhaustive: never = failure.phase;
      return _exhaustive;
    }
  }
}
