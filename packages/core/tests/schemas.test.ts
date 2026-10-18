import test from "node:test";
import assert from "node:assert/strict";
import { formatSchemaIssues, kpiReportSchema, missionSchema, orgPolicySchema } from "../src/schemas/index.js";

const mission = { msn_id: "MSN-0001", skill_key: "ui", gate_command: "npm test", trace_rows: [] };

test("mission schema: minimal mission passes; unknown keys, bad ids and missing cross-field digests fail", () => {
  assert.equal(missionSchema.safeParse(mission).success, true);
  assert.equal(missionSchema.safeParse({ ...mission, msnId: "MSN-0002", msn_id: undefined }).success, true);
  assert.equal(missionSchema.safeParse({ skill_key: "ui", gate_command: "x" }).success, false);
  assert.equal(missionSchema.safeParse({ ...mission, extra: 1 }).success, false);
  assert.equal(missionSchema.safeParse({ ...mission, msn_id: "MSN-1" }).success, false);
  assert.equal(missionSchema.safeParse({ ...mission, contract: { tmvc_roots: ["src/"] } }).success, false);
  assert.equal(missionSchema.safeParse({ ...mission, contract: { tmvc_roots: ["src/"] }, contract_sha256: "a".repeat(64) }).success, true);
  const row = { finding_id: "abcdef123456", kind: "adr_conflict", question: "q", hypothesis: "h", operator_answer: "a" };
  assert.equal(missionSchema.safeParse({ ...mission, interrogation: [row] }).success, false);
  assert.equal(missionSchema.safeParse({ ...mission, interrogation: [row], interrogation_sha256: "b".repeat(64) }).success, true);
  const bad = missionSchema.safeParse({ ...mission, trace_rows: [{ dod_id: "1", trace_quote: "q", anchor: "1", status: "maybe" }] });
  assert.equal(bad.success, false);
  if (!bad.success) assert.match(formatSchemaIssues(bad.error), /^\/trace_rows\/0\/status: /);
});

test("org policy schema: required keys, enums and strict objects", () => {
  const ok = { schema_version: "1.0.0", org_id: "o", policy_id: "p", version: "1", config_floor: { planner_signature: "require" } };
  assert.equal(orgPolicySchema.safeParse(ok).success, true);
  assert.equal(orgPolicySchema.safeParse({ ...ok, schema_version: "2.0.0" }).success, false);
  assert.equal(orgPolicySchema.safeParse({ ...ok, config_floor: { planner_signature: "maybe" } }).success, false);
  assert.equal(orgPolicySchema.safeParse({ ...ok, mandatory_gates: [{ id: "g", command: "c", adapter: "tsc" }] }).success, true);
});

test("kpi report schema: date-time, integer exit code, numeric or boolean metrics", () => {
  const ok = { msn_id: "MSN-0001", generated_at: "2026-01-01T00:00:00Z", exit_code: 0, metrics: { a: 1, b: true } };
  assert.equal(kpiReportSchema.safeParse(ok).success, true);
  assert.equal(kpiReportSchema.safeParse({ ...ok, generated_at: "yesterday" }).success, false);
  assert.equal(kpiReportSchema.safeParse({ ...ok, exit_code: 1.5 }).success, false);
  assert.equal(kpiReportSchema.safeParse({ ...ok, metrics: { a: "x" } }).success, false);
  assert.equal(kpiReportSchema.safeParse({ ...ok, findings: [{ severity: "warn", path: "src/a.ts", message: "m", line: 0 }] }).success, false);
});
