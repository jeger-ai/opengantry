import { CLI_NAME } from "./constants.js";
import type {
  DefensiveFailure,
  GateFailure,
  KpiFailure,
  TraceFailure,
  TracePendingFailure,
} from "./verify-engine.js";
import type {
  NormalizedVerifyFailure,
  NormalizedVerifyFailureBase,
} from "./verify-failure-normalize.js";

export function normalizeGitProofPhase(base: NormalizedVerifyFailureBase): NormalizedVerifyFailure {
  return { ...base, headline: base.message, detail_lines: [] };
}

export function normalizeGatePhase(
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

export function normalizeDefensivePhase(
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

export function normalizeKpiPhase(
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

export function normalizeTracePendingPhase(
  base: NormalizedVerifyFailureBase,
  failure: TracePendingFailure,
): NormalizedVerifyFailure {
  return {
    ...base,
    headline: `${CLI_NAME} verify: legislative stub complete (git-proof OK) — executor must execute, append ${failure.executorLogPath}, set trace row PASS, then re-verify`,
    detail_lines: [],
  };
}

export function normalizeTracePhase(
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
