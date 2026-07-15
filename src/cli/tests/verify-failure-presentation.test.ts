import test from "node:test";
import assert from "node:assert/strict";
import { GXT_ERROR } from "../lib/gxt-error-codes.js";
import {
  normalizeVerifyPhaseFailure,
  toFailurePresentation,
  type VerifyFailurePresentationInput,
} from "../lib/verify-failure-normalize.js";
import type { VerifyPhaseFailure } from "../lib/verify-failure.js";

function verifyFailurePresentation(input: VerifyFailurePresentationInput) {
  return toFailurePresentation(normalizeVerifyPhaseFailure(input));
}

test("verifyFailurePresentation: gate phase includes remediation", () => {
  const failure: VerifyPhaseFailure = {
    ok: false,
    phase: "gate",
    message: "gate failed",
    exitCode: 1,
    executorLogPath: "EXECUTOR_LOG.md",
    gateCommand: "npm test",
    gateStdout: "fail",
    gateStderr: "err",
    gateExitCode: 1,
  };
  const presentation = verifyFailurePresentation({
    failure,
    missionArg: ".gitagent/missions/MSN-0001.yaml",
    options: {},
  });
  assert.equal(presentation.error_code, GXT_ERROR.GATE_FAILED);
  assert.ok(presentation.fix_hints.length > 0);
  assert.ok(presentation.next_actions.length > 0);
});

test("verifyFailurePresentation: trace_pending aligns with fix hints", () => {
  const failure: VerifyPhaseFailure = {
    ok: false,
    phase: "trace_pending",
    message: "pending",
    exitCode: 1,
    executorLogPath: "EXECUTOR_LOG.md",
  };
  const presentation = verifyFailurePresentation({
    failure,
    missionArg: ".gitagent/missions/MSN-0001.yaml",
    options: {},
  });
  assert.equal(presentation.error_code, GXT_ERROR.TRACE_PENDING);
  assert.ok(presentation.next_actions.length >= 2);
});

test("verifyFailurePresentation: trace uses engine traceKind", () => {
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
  const presentation = verifyFailurePresentation({
    failure,
    missionArg: ".gitagent/missions/MSN-0001.yaml",
    options: {},
  });
  assert.equal(presentation.error_code, GXT_ERROR.TRACE_AMBIGUOUS);
});
