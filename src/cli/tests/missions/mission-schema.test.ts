import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getRepoRoot } from "#git/git.js";
import { validateYamlMission } from "#missions/mission/parser.js";
test("mission schema: rejects unknown top-level keys", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-schema-"));
  const ogRoot = getRepoRoot();
  fs.mkdirSync(path.join(root, ".gitagent", "planner"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "planner", "MISSION.schema.yaml"),
    path.join(root, ".gitagent", "planner", "MISSION.schema.yaml"),
  );
  const body = `msn_id: MSN-0990
skill_key: gantry
gate_command: echo OK
unknown_field: true
trace_rows: []
`;
  const file = path.join(root, "bad.yaml");
  fs.writeFileSync(file, body, "utf8");
  assert.throws(() => validateYamlMission(root, file, body), /GXT_MISSION_SCHEMA_INVALID/);
});

test("mission schema: kpi_gate, llm_verifiers and aggregators are refused as removed in 4.0 (MSN-0355)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-schema-kpi-"));
  const ogRoot = getRepoRoot();
  fs.mkdirSync(path.join(root, ".gitagent", "planner"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "planner", "MISSION.schema.yaml"),
    path.join(root, ".gitagent", "planner", "MISSION.schema.yaml"),
  );
  const body = `msn_id: MSN-0991
skill_key: gantry
gate_command: echo OK
kpi_gate:
  report_path: ".gitagent/kpi/MSN-0991.json"
  thresholds:
    - metric: "anthropic::complexity_score"
      op: "<="
      value: 12
llm_verifiers:
  - id: anthropic
    command: echo '{}'
aggregators:
  - key: security_flaws
    op: max
    sources: ["anthropic::complexity_score"]
trace_rows: []
`;
  const file = path.join(root, "kpi-mission.yaml");
  fs.writeFileSync(file, body, "utf8");
  assert.throws(() => validateYamlMission(root, file, body), /GXT_MISSION_SCHEMA_INVALID: .*kpi_gate, llm_verifiers, aggregators were removed in 4\.0 \(ADR-0061\)/);
});

test("mission schema: depends_on[].expected_repository_hash is refused as removed in 4.0 (ADR-0061)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-schema-dep-hash-"));
  fs.mkdirSync(path.join(root, ".gitagent", "planner"), { recursive: true });
  fs.copyFileSync(
    path.join(getRepoRoot(), ".gitagent", "planner", "MISSION.schema.yaml"),
    path.join(root, ".gitagent", "planner", "MISSION.schema.yaml"),
  );
  const body = `msn_id: MSN-0992
skill_key: gantry
gate_command: echo OK
trace_rows: []
depends_on:
  - repo: github.com/jeger-ai/producer
    msn_id: MSN-0100
    expected_repository_hash: "${"0".repeat(64)}"
`;
  const file = path.join(root, "dep-mission.yaml");
  fs.writeFileSync(file, body, "utf8");
  assert.throws(() => validateYamlMission(root, file, body), /GXT_MISSION_SCHEMA_INVALID: .*depends_on\[\]\.expected_repository_hash was removed in 4\.0 \(ADR-0061\)/);
});

test("mission schema: example.verify.yaml passes validateYamlMission", () => {
  const ogRoot = getRepoRoot();
  const rel = ".gitagent/missions/example.verify.yaml";
  const body = fs.readFileSync(path.join(ogRoot, rel), "utf8");
  const parsed = validateYamlMission(ogRoot, rel, body);
  assert.equal(parsed.skillKey, "logic");
});

test("mission schema: interrogation requires interrogation_sha256", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-schema-interrogate-"));
  const ogRoot = getRepoRoot();
  fs.mkdirSync(path.join(root, ".gitagent", "planner"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "planner", "MISSION.schema.yaml"),
    path.join(root, ".gitagent", "planner", "MISSION.schema.yaml"),
  );
  const body = `msn_id: MSN-0992
skill_key: gantry
gate_command: echo OK
interrogation:
  - finding_id: abc
    kind: missing_test_criteria
    question: q
    hypothesis: h
    operator_answer: ok
trace_rows: []
`;
  const file = path.join(root, "bad-interrogate.yaml");
  fs.writeFileSync(file, body, "utf8");
  assert.throws(() => validateYamlMission(root, file, body), /GXT_MISSION_SCHEMA_INVALID/);
});
