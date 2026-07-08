import test from "node:test";
import assert from "node:assert/strict";
import {
  archOverrideAdvisoryMessage,
  commitSubjectHasArchOverride,
} from "../lib/arch-override.js";
import { evaluateKpiThresholds } from "../lib/kpi-engine.js";
import type { KpiReport } from "../lib/types.js";

test("arch-override: detects token in commit subject", () => {
  assert.equal(commitSubjectHasArchOverride("[MSN-0001] [GXT-ARCH-OVERRIDE] accept rubric"), true);
  assert.equal(commitSubjectHasArchOverride("[MSN-0001] legislate"), false);
});

test("arch-override: advisory message format", () => {
  assert.match(archOverrideAdvisoryMessage("MSN-0001", "abc123"), /GXT-ARCH-OVERRIDE/);
});

test("kpi findings do not affect threshold evaluation", () => {
  const report: KpiReport = {
    msn_id: "MSN-0001",
    generated_at: "2026-01-01T00:00:00.000Z",
    metrics: { ok: 1 },
    findings: [{ id: "RULE-LIB-COMMANDER", severity: "error", path: "src/x.ts", message: "advisory only" }],
    exit_code: 0,
  };
  const failures = evaluateKpiThresholds(report, [{ metric: "ok", op: ">=", value: 1 }]);
  assert.equal(failures.length, 0);
});
