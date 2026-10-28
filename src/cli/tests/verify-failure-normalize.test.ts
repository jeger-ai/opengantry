import test from "node:test";
import assert from "node:assert/strict";
import { GXT_ERROR } from "#core/error-codes.js";
import type { VerifyPhaseFailure } from "#missions/mission-verify/failure.js";
import {
  normalizeVerifyPhaseFailure,
  toFailurePresentation,
  toRemediationSnapshot,
} from "#missions/mission-verify/failure-normalize.js";
import { buildFindingsForFailure, toVerifyFailedPayload } from "#missions/mission-verify/payload.js";
import { REMEDIATION_SCHEMA_VERSION } from "#missions/context-feed-store.js";

const missionArg = ".gitagent/missions/MSN-0001.yaml";

function gateFailure(): VerifyPhaseFailure {
  return {
    ok: false,
    phase: "gate",
    message: "gate failed",
    exitCode: 1,
    executorLogPath: "EXECUTOR_LOG.md",
    gateCommand: "npm test",
    gateOutput: "fail out\nfail err",
    gateExitCode: 1,
  };
}

test("normalizeVerifyPhaseFailure: gate parity across sinks", () => {
  const failure = gateFailure();
  const normalized = normalizeVerifyPhaseFailure({
    failure,
    missionArg,
    options: {},
  });
  const findings = buildFindingsForFailure("", normalized, failure);
  const payload = toVerifyFailedPayload(normalized, failure, findings);
  const presentation = toFailurePresentation(normalized);
  const remediation = toRemediationSnapshot(normalized);

  assert.equal(payload.error_code, GXT_ERROR.GATE_FAILED);
  assert.equal(presentation.error_code, GXT_ERROR.GATE_FAILED);
  assert.equal(remediation.error_code, GXT_ERROR.GATE_FAILED);
  assert.equal(payload.stdout, "fail out\nfail err");
  assert.equal(remediation.gate?.stdout, "fail out\nfail err");
  assert.equal(remediation.gate?.exit_code, 1);
  assert.equal(presentation.gate?.stdout, "fail out\nfail err");
  assert.equal(remediation.schema_version, REMEDIATION_SCHEMA_VERSION);
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
    declaredLine: 42,
  };
  const normalized = normalizeVerifyPhaseFailure({ failure, missionArg, options: {} });
  const findings = buildFindingsForFailure("", normalized, failure);
  const payload = toVerifyFailedPayload(normalized, failure, findings);
  const presentation = toFailurePresentation(normalized);
  const remediation = toRemediationSnapshot(normalized);

  assert.deepEqual(payload.failures, ["DoD trace: Ambiguous match"]);
  assert.deepEqual(remediation.failures, ["DoD trace: Ambiguous match"]);
  assert.deepEqual(presentation.trace?.failures, ["DoD trace: Ambiguous match"]);
});
