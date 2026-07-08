import test from "node:test";
import assert from "node:assert/strict";
import { buildJUnitXml, buildSarifDocument, buildVerifyExportDocument } from "../lib/verify-export.js";
import { GXT_ERROR } from "../lib/gxt-error-codes.js";

test("verify-export: SARIF failure uses GXT error code as ruleId", () => {
  const sarif = buildSarifDocument({
    status: "failed",
    phase: "gate",
    message: "GATE FAILED",
    error_code: GXT_ERROR.GATE_FAILED,
    fix_hints: ["re-run gate"],
    next_actions: ["gantry verify"],
    exit_code: 1,
  });
  const run = (sarif.runs as Record<string, unknown>[])[0] as Record<string, unknown>;
  const results = run.results as Record<string, unknown>[];
  assert.equal(results[0]?.ruleId, GXT_ERROR.GATE_FAILED);
});

test("verify-export: JUnit pass emits phase testcases", () => {
  const xml = buildJUnitXml({
    status: "passed",
    phase: "full",
    exit_code: 0,
    msn_id: "MSN-0001",
    mission_file_path: ".gitagent/missions/m.yaml",
  });
  assert.match(xml, /testsuites/);
  assert.match(xml, /testcase classname="gantry.verify" name="git_proof"/);
  assert.doesNotMatch(xml, /<failure/);
});

test("verify-export: JUnit fail includes failure element", () => {
  const xml = buildJUnitXml({
    status: "failed",
    phase: "trace",
    message: "trace missing",
    error_code: GXT_ERROR.TRACE_MISSING,
    fix_hints: [],
    next_actions: [],
    exit_code: 1,
  });
  assert.match(xml, /<failure/);
  assert.match(xml, /name="trace"/);
});

test("verify-export: json format round-trips payload", () => {
  const payload = { status: "passed" as const, phase: "full" as const, exit_code: 0 as const };
  const doc = buildVerifyExportDocument(payload, "json");
  assert.deepEqual(JSON.parse(doc), payload);
});
