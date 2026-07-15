import test from "node:test";
import assert from "node:assert/strict";
import { GXT_ERROR } from "../lib/gxt-error-codes.js";
import { hintsForVerifyPhase } from "../lib/verify-hints.js";

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
      gitProofMessage: "NO_MSN_COMMITS",
    },
    meta,
  );
  assert.equal(remediation.error_code, GXT_ERROR.MISSION_UNSTAMPED);
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
      gateStdout: gateJson,
    },
    meta,
  );
  assert.equal(remediation.error_code, GXT_ERROR.IMPORT_LAYER_VIOLATION);
});

test("hintsForVerifyPhase: kpi stale maps error code", () => {
  const remediation = hintsForVerifyPhase(
    {
      ok: false,
      phase: "kpi",
      message: "KPI report stale",
      exitCode: 1,
      executorLogPath: "EXECUTOR_LOG.md",
      kpiKind: "stale",
      kpiReason: "KPI report STALE (attested at abc1234)",
      kpiReportPath: ".gitagent/kpi/MSN-0001.json",
    },
    meta,
  );
  assert.equal(remediation.error_code, GXT_ERROR.KPI_REPORT_STALE);
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
      traceReason: "Trace STALE",
      traceQuote: "DoD 1 MSN-0001: quote",
    },
    meta,
  );
  assert.equal(remediation.error_code, GXT_ERROR.TRACE_STALE);
});
