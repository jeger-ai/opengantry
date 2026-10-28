import test from "node:test";
import assert from "node:assert/strict";
import { junitXml, sarifLog, type JUnitCase } from "#verify/export.js";
import { payloadExportFindings, payloadJUnitCases, type VerifyResultPayload } from "#missions/mission-verify/payload.js";
import type { VerifyPhaseResult } from "#missions/mission-verify/engine.js";
import { GXT_ERROR } from "#core/error-codes.js";
import { VERIFY_ENVELOPE_SCHEMA_VERSION, verifyFinding } from "#missions/mission-verify/finding.js";

const GENERIC_SARIF_FILE = ".gitagent/foreman/MANIFEST.yaml";
const JUNIT_SUITE_NAME = "gantry-verify";

/** The mission SARIF document as `gantry verify --format sarif` builds it. */
function buildSarifDocument(
  payload: VerifyResultPayload,
  cliVersion: string,
  isDirectory: (uri: string) => boolean = (uri) => uri.endsWith("/"),
): Record<string, unknown> {
  return sarifLog(cliVersion, payloadExportFindings(payload, isDirectory));
}

/** The mission JUnit document as `gantry verify --format junit` builds it. */
function buildJUnitXml(payload: VerifyResultPayload, input?: VerifyPhaseResult | JUnitCase[]): string {
  const cases = Array.isArray(input) ? input : payloadJUnitCases(payload, input);
  return junitXml(JUNIT_SUITE_NAME, "gantry.verify", cases);
}

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
  }, "0.0.0-test");
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
  }, "0.0.0-test");
  const run = (sarif.runs as Record<string, unknown>[])[0] as Record<string, unknown>;
  const results = run.results as Record<string, unknown>[];
  assert.equal(results[0]?.ruleId, "gate");
});

test("verify-export: JUnit pass emits phase testcases", () => {
  const xml = buildJUnitXml(
    {
      status: "passed",
      phase: "full",
      exit_code: 0,
      msn_id: "MSN-0001",
      mission_file_path: ".gitagent/missions/m.yaml",
    },
    { ok: true, outcome: "full", proofMsnId: "MSN-0001", executorLogPath: "EXECUTOR_LOG.md", traceWarnings: [] },
  );
  assert.match(xml, /testsuites/);
  assert.match(xml, /testcase classname="gantry.verify" name="git_proof"/);
  assert.doesNotMatch(xml, /<failure/);
});

test("verify-export: JUnit without phase results has one case for the payload phase", () => {
  const xml = buildJUnitXml({ status: "passed", phase: "break_glass", exit_code: 0 });
  assert.match(xml, /tests="1"/);
  assert.match(xml, /name="break_glass"\/>/);
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
  }, "0.0.0-test");
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

function sarifLocations(sarif: Record<string, unknown>): Array<Record<string, unknown>> {
  const run = (sarif.runs as Record<string, unknown>[])[0] as Record<string, unknown>;
  const results = run.results as Array<Record<string, unknown>>;
  return (results[0]?.locations as Array<Record<string, unknown>>) ?? [];
}

test("verify-export: SARIF file finding keeps a line region", () => {
  const sarif = buildSarifDocument({
    status: "failed",
    phase: "contract",
    message: "import violation",
    error_code: GXT_ERROR.GATE_FAILED,
    fix_hints: [],
    next_actions: [],
    exit_code: 1,
    envelope_schema_version: VERIFY_ENVELOPE_SCHEMA_VERSION,
    findings: [verifyFinding("contract", "fix import", { offending_file: "src/foo.ts", line: 4 })],
  }, "0.0.0-test");
  const physical = sarifLocations(sarif)[0]?.physicalLocation as Record<string, unknown>;
  const artifact = physical.artifactLocation as Record<string, string>;
  assert.equal(artifact.uri, "src/foo.ts");
  assert.equal((physical.region as Record<string, number>).startLine, 4);
});

test("verify-export: SARIF omits region when the caller says the uri is a directory", () => {
  const base = {
    status: "failed" as const,
    phase: "contract" as const,
    message: "untracked directory",
    error_code: GXT_ERROR.GATE_FAILED,
    fix_hints: [],
    next_actions: [],
    exit_code: 1 as const,
    envelope_schema_version: VERIFY_ENVELOPE_SCHEMA_VERSION,
  };
  const trailing = buildSarifDocument({
    ...base,
    findings: [verifyFinding("contract", "remove dir", { offending_file: "src/new-module/" })],
  }, "0.0.0-test");
  const forced = buildSarifDocument(
    {
      ...base,
      findings: [verifyFinding("contract", "remove dir", { offending_file: "src/new-module" })],
    }, "0.0.0-test",
    () => true,
  );
  for (const sarif of [trailing, forced]) {
    const physical = sarifLocations(sarif)[0]?.physicalLocation as Record<string, unknown>;
    assert.equal(physical.region, undefined);
  }
});

test("verify-export: SARIF generic failure points at the mission file", () => {
  const sarif = buildSarifDocument({
    status: "failed",
    phase: "git_proof",
    message: "missing Planner stamp",
    error_code: GXT_ERROR.GATE_FAILED,
    fix_hints: [],
    next_actions: [],
    exit_code: 1,
    envelope_schema_version: VERIFY_ENVELOPE_SCHEMA_VERSION,
    mission_file_path: ".gitagent/missions/m.yaml",
    findings: [verifyFinding("git_proof", "missing Planner stamp")],
  }, "0.0.0-test");
  const physical = sarifLocations(sarif)[0]?.physicalLocation as Record<string, unknown>;
  const artifact = physical.artifactLocation as Record<string, string>;
  assert.equal(artifact.uri, ".gitagent/missions/m.yaml");
  assert.equal((physical.region as Record<string, number>).startLine, 1);
  assert.equal((sarif as { version: string }).version, "2.1.0");
});

test("verify-export: SARIF failure without a mission file falls back to the manifest", () => {
  const sarif = buildSarifDocument({
    status: "failed",
    phase: "init",
    message: "bad mission",
    error_code: GXT_ERROR.PARSE_ERROR,
    fix_hints: [],
    next_actions: [],
    exit_code: 1,
    envelope_schema_version: VERIFY_ENVELOPE_SCHEMA_VERSION,
    findings: [verifyFinding("init", "bad mission")],
  }, "0.0.0-test");
  const physical = sarifLocations(sarif)[0]?.physicalLocation as Record<string, unknown>;
  const artifact = physical.artifactLocation as Record<string, string>;
  assert.equal(artifact.uri, GENERIC_SARIF_FILE);
  assert.equal((physical.region as Record<string, number>).startLine, 1);
});

test("verify-export: JUnit phases use testsuites root and escape failure text", () => {
  const raw = `a & b <c> "d" 'e'`;
  const xml = buildJUnitXml(
    {
      status: "failed",
      phase: "gate",
      message: raw,
      error_code: GXT_ERROR.GATE_FAILED,
      fix_hints: [],
      next_actions: [],
      exit_code: 1,
      envelope_schema_version: VERIFY_ENVELOPE_SCHEMA_VERSION,
      findings: [],
    },
    [
      { name: "git_proof" },
      { name: "gate", failure: raw },
      { name: "trace", skipped: true },
    ],
  );
  assert.match(xml, /^<\?xml/);
  assert.match(xml, /<testsuites /);
  assert.match(xml, new RegExp(`<testsuite name="${JUNIT_SUITE_NAME}"`));
  assert.match(xml, /name="git_proof"\/>/);
  assert.match(xml, /name="trace"><skipped\/><\/testcase>/);
  const escaped = "a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;";
  assert.match(xml, new RegExp(`<failure message="${escaped}">${escaped}</failure>`));
});
