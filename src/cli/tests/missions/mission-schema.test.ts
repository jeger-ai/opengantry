import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getRepoRoot } from "../../lib/git.js";
import { validateYamlMission } from "../../lib/missions/parser.js";
test("mission schema: rejects unknown top-level keys", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-schema-"));
  const ogRoot = getRepoRoot();
  fs.mkdirSync(path.join(root, ".gitagent", "planner"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "planner", "MISSION.schema.yaml"),
    path.join(root, ".gitagent", "planner", "MISSION.schema.yaml"),
  );
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "planner", "KPI-REPORT.schema.yaml"),
    path.join(root, ".gitagent", "planner", "KPI-REPORT.schema.yaml"),
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

test("mission schema: kpi_gate and llm_verifiers pass validateYamlMission", () => {
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
  const parsed = validateYamlMission(root, file, body);
  assert.equal(parsed.kpiGate?.reportPath, ".gitagent/kpi/MSN-0991.json");
  assert.equal(parsed.llmVerifiers.length, 1);
  assert.equal(parsed.aggregators[0]?.op, "max");
});

test("mission schema: example.verify.yaml passes validateYamlMission", () => {
  const ogRoot = getRepoRoot();
  const rel = ".gitagent/missions/example.verify.yaml";
  const body = fs.readFileSync(path.join(ogRoot, rel), "utf8");
  const parsed = validateYamlMission(ogRoot, rel, body);
  assert.equal(parsed.skillKey, "logic");
});
