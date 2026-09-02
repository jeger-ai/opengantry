import test from "node:test";
import assert from "node:assert/strict";
import { buildJUnitXml, buildSarifDocument, buildVerifyExportDocument } from "../lib/verify-export.js";
import { GXT_ERROR } from "../lib/gxt-error-codes.js";
import { VERIFY_ENVELOPE_SCHEMA_VERSION, verifyFinding } from "../lib/verify-finding.js";

test("verify-export: SARIF uses rule_id and span columns", () => {
  const sarif = buildSarifDocument({
    status: "failed",
    phase: "gate",
    message: "GATE FAILED",
    error_code: GXT_ERROR.GATE_FAILED,
    fix_hints: [],
    next_actions: [],
    exit_code: 1,
    envelope_schema_version: VERIFY_ENVELOPE_SCHEMA_VERSION,
    findings: [
      verifyFinding("gate", "fix import", {
        offending_file: "src/foo.ts",
        line: 10,
        start_column: 3,
        rule_id: "import-layer",
      }),
    ],
  });
  const run = (sarif.runs as Record<string, unknown>[])[0] as Record<string, unknown>;
  const results = run.results as Array<Record<string, unknown>>;
  assert.equal(results[0]?.ruleId, "import-layer");
  const region = (
    (results[0]?.locations as Array<Record<string, unknown>>)[0] as Record<string, unknown>
  ).physicalLocation as Record<string, unknown>;
  const r = region.region as Record<string, number>;
  assert.equal(r.startLine, 10);
  assert.equal(r.startColumn, 3);
});

test("verify-export: SARIF failure uses finding failed_gate as ruleId", () => {
  const sarif = buildSarifDocument({
    status: "failed",
    phase: "gate",
    message: "GATE FAILED",
    error_code: GXT_ERROR.GATE_FAILED,
    fix_hints: ["re-run gate"],
    next_actions: ["gantry verify"],
    exit_code: 1,
    envelope_schema_version: VERIFY_ENVELOPE_SCHEMA_VERSION,
    findings: [verifyFinding("gate", "re-run gate")],
  });
  const run = (sarif.runs as Record<string, unknown>[])[0] as Record<string, unknown>;
  const results = run.results as Record<string, unknown>[];
  assert.equal(results[0]?.ruleId, "gate");
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
    envelope_schema_version: VERIFY_ENVELOPE_SCHEMA_VERSION,
    findings: [
      verifyFinding("trace", "append trace evidence", {
        offending_file: "EXECUTOR_LOG.md",
      }),
    ],
  });
  assert.match(xml, /<failure/);
  assert.match(xml, /name="trace"/);
});

test("verify-export: interrogation phase SARIF uses GXT_INTERROGATION ruleId", () => {
  const sarif = buildSarifDocument({
    status: "failed",
    phase: "interrogation",
    message: "interrogation mismatch",
    error_code: GXT_ERROR.INTERROGATION_MISMATCH,
    fix_hints: ["re-interrogate"],
    next_actions: ["gantry interrogate"],
    exit_code: 1,
    envelope_schema_version: VERIFY_ENVELOPE_SCHEMA_VERSION,
    findings: [
      verifyFinding("interrogation", "fix interrogation block", {
        offending_file: ".gitagent/missions/MSN-0001.yaml",
      }),
    ],
  });
  const run = (sarif.runs as Record<string, unknown>[])[0] as Record<string, unknown>;
  const results = run.results as Record<string, unknown>[];
  assert.equal(results[0]?.ruleId, "interrogation");
});

test("verify-export: interrogation phase JUnit names interrogation testcase", () => {
  const xml = buildJUnitXml({
    status: "failed",
    phase: "interrogation",
    message: "path drift",
    error_code: GXT_ERROR.INTERROGATION_PATH_DRIFT,
    fix_hints: [],
    next_actions: [],
    exit_code: 1,
    envelope_schema_version: VERIFY_ENVELOPE_SCHEMA_VERSION,
    findings: [verifyFinding("interrogation", "declare paths")],
  });
  assert.match(xml, /name="interrogation"/);
  assert.match(xml, /<failure/);
});

test("verify-export: json format round-trips payload", () => {
  const payload = { status: "passed" as const, phase: "full" as const, exit_code: 0 as const };
  const doc = buildVerifyExportDocument(payload, "json");
  assert.deepEqual(JSON.parse(doc), payload);
});
