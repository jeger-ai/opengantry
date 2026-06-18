import test from "node:test";
import assert from "node:assert/strict";
import { GXT_ERROR } from "../lib/gxt-error-codes.js";
import { hintsForVerifyPhase } from "../lib/verify-hints.js";

const mission = ".gitagent/missions/MSN-0001.yaml";

test("hintsForVerifyPhase: git_proof maps error code", () => {
  const remediation = hintsForVerifyPhase("git_proof", {
    missionPath: mission,
    gitProofMessage: "NO_MSN_COMMITS",
  });
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
  const remediation = hintsForVerifyPhase("gate", {
    missionPath: mission,
    gateCommand: "npm test",
    gateStdout: gateJson,
  });
  assert.equal(remediation.error_code, GXT_ERROR.IMPORT_LAYER_VIOLATION);
});

test("hintsForVerifyPhase: kpi stale maps error code", () => {
  const remediation = hintsForVerifyPhase("kpi", {
    missionPath: mission,
    kpiFailureReason: "KPI report STALE (attested at abc1234)",
  });
  assert.equal(remediation.error_code, GXT_ERROR.KPI_REPORT_STALE);
});

test("hintsForVerifyPhase: trace_pending includes worker steps", () => {
  const remediation = hintsForVerifyPhase("trace_pending", {
    missionPath: mission,
    workerLogPath: "WORKER_LOG.md",
    gateCommand: "npm test",
  });
  assert.equal(remediation.error_code, GXT_ERROR.TRACE_PENDING);
  assert.ok(remediation.next_actions.length >= 3);
});

test("hintsForVerifyPhase: trace stale evidence", () => {
  const remediation = hintsForVerifyPhase("trace", {
    missionPath: mission,
    workerLogPath: "WORKER_LOG.md",
    traceKind: "stale_evidence",
  });
  assert.equal(remediation.error_code, GXT_ERROR.TRACE_STALE);
});
