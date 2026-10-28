import test from "node:test";
import assert from "node:assert/strict";
import { GXT_ERROR } from "#core/error-codes.js";
import { hintsForVerifyPhase } from "#missions/mission-verify/hints.js";

const mission = ".gitagent/missions/MSN-0001.yaml";
const meta = { missionPath: mission };

test("hintsForVerifyPhase: git_proof maps error code", () => {
  const remediation = hintsForVerifyPhase(
    {
      ok: false,
      phase: "git_proof",
      message: "NO_MSN_COMMITS",
      exitCode: 1,
      executorLogPath: "EXECUTOR_LOG.md",
    },
    meta,
  );
  assert.equal(remediation.error_code, GXT_ERROR.MISSION_UNSTAMPED);
  assert.equal(remediation.headline, "NO_MSN_COMMITS");
  assert.ok(remediation.fix_hints.length > 0);
});

test("hintsForVerifyPhase: gate detects import layer violation", () => {
  const gateJson = JSON.stringify({
    schema_version: 1,
    ok: false,
    violations: [
      {
        file: "src/cli/lib/bad.ts",
        rule_id: "RULE-LIB-TO-COMMAND",
        module_specifier: "../commands/verify.js",
        bindings: ["runVerify"],
        line: 1,
        column: 1,
      },
    ],
  });
  const remediation = hintsForVerifyPhase(
    {
      ok: false,
      phase: "gate",
      message: "GATE FAILED",
      exitCode: 1,
      executorLogPath: "EXECUTOR_LOG.md",
      gateCommand: "npm test",
      gateOutput: gateJson,
    },
    meta,
  );
  assert.equal(remediation.error_code, GXT_ERROR.IMPORT_LAYER_VIOLATION);
});

test("hintsForVerifyPhase: trace_pending includes executor steps", () => {
  const remediation = hintsForVerifyPhase(
    {
      ok: false,
      phase: "trace_pending",
      message: "pending",
      exitCode: 1,
      executorLogPath: "EXECUTOR_LOG.md",
      gateCommand: "npm test",
    },
    meta,
  );
  assert.equal(remediation.error_code, GXT_ERROR.TRACE_PENDING);
  assert.ok(remediation.next_actions.length >= 3);
  assert.deepEqual(remediation.fix_hints, remediation.next_actions.slice(0, 3));
});

test("hintsForVerifyPhase: trace stale evidence", () => {
  const remediation = hintsForVerifyPhase(
    {
      ok: false,
      phase: "trace",
      message: "Trace STALE",
      exitCode: 1,
      executorLogPath: "EXECUTOR_LOG.md",
      traceKind: "stale_evidence",
      traceQuote: "DoD 1 MSN-0001: quote",
    },
    meta,
  );
  assert.equal(remediation.error_code, GXT_ERROR.TRACE_STALE);
});

test("hintsForVerifyPhase: gate headline and output details", () => {
  const remediation = hintsForVerifyPhase(
    {
      ok: false,
      phase: "gate",
      message: "GATE FAILED",
      exitCode: 1,
      executorLogPath: "EXECUTOR_LOG.md",
      gateCommand: "npm test",
      gateOutput: "fail out\nfail err",
      gateExitCode: 1,
    },
    meta,
  );
  assert.equal(remediation.error_code, GXT_ERROR.GATE_FAILED);
  assert.equal(remediation.headline, "verify: GATE FAILED");
  assert.deepEqual(remediation.detail_lines, ["--- output ---\nfail out\nfail err", "exit code: 1"]);
  assert.equal(remediation.failures, undefined);
});

test("hintsForVerifyPhase: trace failures and details carry the reason", () => {
  const remediation = hintsForVerifyPhase(
    {
      ok: false,
      phase: "trace",
      message: "Ambiguous match",
      exitCode: 1,
      executorLogPath: "EXECUTOR_LOG.md",
      traceKind: "ambiguous",
      traceQuote: "DoD 1 MSN-0001: quote",
      declaredLine: 42,
    },
    meta,
  );
  assert.equal(remediation.error_code, GXT_ERROR.TRACE_AMBIGUOUS);
  assert.deepEqual(remediation.failures, ["DoD trace: Ambiguous match"]);
  assert.deepEqual(remediation.detail_lines, ["DoD trace failure: Ambiguous match"]);
});
