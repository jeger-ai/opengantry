import { CLI_NAME } from "./constants.js";
import type { VerifyPhaseFailure } from "./verify-engine.js";
import type {
  NormalizedVerifyFailure,
  NormalizedVerifyFailureBase,
} from "./verify-failure-normalize.js";

export function normalizeGitProofPhase(base: NormalizedVerifyFailureBase): NormalizedVerifyFailure {
  return { ...base, headline: base.message, detail_lines: [] };
}

export function normalizeGatePhase(
  base: NormalizedVerifyFailureBase,
  failure: VerifyPhaseFailure,
): NormalizedVerifyFailure {
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
}

export function normalizeKpiPhase(
  base: NormalizedVerifyFailureBase,
  failure: VerifyPhaseFailure,
): NormalizedVerifyFailure {
  const reason = failure.kpiReason ?? failure.message;
  return {
    ...base,
    headline: "verify: KPI GATE FAILED",
    detail_lines: [
      reason,
      ...(failure.kpiMetric
        ? [`metric: ${failure.kpiMetric} ${failure.kpiOp ?? ""} ${String(failure.kpiExpected ?? "")} (actual: ${String(failure.kpiActual ?? "missing")})`]
        : []),
      ...(failure.kpiReportPath ? [`report: ${failure.kpiReportPath}`] : []),
    ],
    failures: [reason],
    kpi: {
      ...(failure.kpiMetric ? { metric: failure.kpiMetric } : {}),
      ...(failure.kpiOp ? { op: failure.kpiOp } : {}),
      ...(failure.kpiExpected !== undefined ? { expected: failure.kpiExpected } : {}),
      ...(failure.kpiActual !== undefined ? { actual: failure.kpiActual } : {}),
      ...(failure.kpiReportPath ? { report_path: failure.kpiReportPath } : {}),
    },
  };
}

export function normalizeTracePendingPhase(
  base: NormalizedVerifyFailureBase,
  failure: VerifyPhaseFailure,
): NormalizedVerifyFailure {
  return {
    ...base,
    headline: `${CLI_NAME} verify: legislative stub complete (git-proof OK) — executor must execute, append ${failure.executorLogPath}, set trace row PASS, then re-verify`,
    detail_lines: [],
  };
}

export function normalizeTracePhase(
  base: NormalizedVerifyFailureBase,
  failure: VerifyPhaseFailure,
): NormalizedVerifyFailure {
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
}
