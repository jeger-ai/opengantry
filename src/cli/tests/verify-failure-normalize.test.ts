import test from "node:test";
import assert from "node:assert/strict";
import { GXT_ERROR } from "../lib/gxt-error-codes.js";
import type { VerifyPhaseFailure } from "../lib/verify-engine.js";
import {
  normalizeVerifyPhaseFailure,
  toFailurePresentation,
  toRemediationSnapshot,
  toVerifyFailedPayload,
} from "../lib/verify-failure-normalize.js";
import { REMEDIATION_SCHEMA_VERSION } from "../lib/context-feed-store.js";

const missionArg = ".gitagent/missions/MSN-0001.yaml";

function gateFailure(): VerifyPhaseFailure {
  return {
    ok: false,
    phase: "gate",
    message: "gate failed",
    exitCode: 1,
    executorLogPath: "EXECUTOR_LOG.md",
    gateCommand: "npm test",
    gateStdout: "fail out",
    gateStderr: "fail err",
    gateExitCode: 1,
  };
}

test("normalizeVerifyPhaseFailure: gate parity across sinks", () => {
  const normalized = normalizeVerifyPhaseFailure({
    failure: gateFailure(),
    missionArg,
    options: {},
  });
  const payload = toVerifyFailedPayload(normalized);
  const presentation = toFailurePresentation(normalized);
  const remediation = toRemediationSnapshot(normalized);

  assert.equal(payload.error_code, GXT_ERROR.GATE_FAILED);
  assert.equal(presentation.error_code, GXT_ERROR.GATE_FAILED);
  assert.equal(remediation.error_code, GXT_ERROR.GATE_FAILED);
  assert.equal(payload.stdout, "fail out");
  assert.equal(payload.stderr, "fail err");
  assert.equal(remediation.gate?.stdout, "fail out");
  assert.equal(remediation.gate?.stderr, "fail err");
  assert.equal(remediation.gate?.exit_code, 1);
  assert.equal(presentation.gate?.stdout, "fail out");
  assert.equal(remediation.schema_version, REMEDIATION_SCHEMA_VERSION);
});

test("normalizeVerifyPhaseFailure: kpi includes snapshot kpi block", () => {
  const failure: VerifyPhaseFailure = {
    ok: false,
    phase: "kpi",
    message: "kpi fail",
    exitCode: 1,
    executorLogPath: "EXECUTOR_LOG.md",
    kpiKind: "threshold",
    kpiReason: "threshold miss",
    kpiMetric: "complexity",
    kpiOp: "<=",
    kpiExpected: 10,
    kpiActual: 12,
    kpiReportPath: ".gitagent/kpi/MSN-0001.json",
  };
  const normalized = normalizeVerifyPhaseFailure({ failure, missionArg, options: {} });
  const payload = toVerifyFailedPayload(normalized);
  const remediation = toRemediationSnapshot(normalized);

  assert.deepEqual(payload.failures, ["threshold miss"]);
  assert.deepEqual(remediation.failures, ["threshold miss"]);
  assert.equal(remediation.kpi?.metric, "complexity");
  assert.equal(remediation.kpi?.actual, 12);
});

test("normalizeVerifyPhaseFailure: trace failures aligned", () => {
  const failure: VerifyPhaseFailure = {
    ok: false,
    phase: "trace",
    message: "trace fail",
    exitCode: 1,
    executorLogPath: "EXECUTOR_LOG.md",
    traceKind: "ambiguous",
    traceReason: "Ambiguous match",
    traceQuote: "DoD 1 MSN-0001: quote",
  };
  const normalized = normalizeVerifyPhaseFailure({ failure, missionArg, options: {} });
  const payload = toVerifyFailedPayload(normalized);
  const presentation = toFailurePresentation(normalized);
  const remediation = toRemediationSnapshot(normalized);

  assert.deepEqual(payload.failures, ["DoD trace: Ambiguous match"]);
  assert.deepEqual(remediation.failures, ["DoD trace: Ambiguous match"]);
  assert.deepEqual(presentation.trace?.failures, ["DoD trace: Ambiguous match"]);
});
