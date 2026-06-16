import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getRepoRoot } from "../lib/git.js";
import { evaluateKpiThresholds, loadKpiReport } from "../lib/kpi-report.js";
import { evaluateKpiPhase } from "../lib/kpi-phase.js";
import type { KpiGateSpec, KpiReport } from "../lib/types.js";
import { copyMissionSchema, writeManifest } from "./test-fixtures.js";

test("evaluateKpiThresholds: passes when metrics meet thresholds", () => {
  const report: KpiReport = {
    msn_id: "MSN-0028",
    generated_at: "2026-06-16T07:30:00Z",
    exit_code: 0,
    metrics: {
      "anthropic::complexity_score": 8,
      security_flaws: 0,
    },
  };
  const failures = evaluateKpiThresholds(report, [
    { metric: "anthropic::complexity_score", op: "<=", value: 12 },
    { metric: "security_flaws", op: "==", value: 0 },
  ]);
  assert.equal(failures.length, 0);
});

test("evaluateKpiThresholds: fails on threshold breach", () => {
  const report: KpiReport = {
    msn_id: "MSN-0028",
    generated_at: "2026-06-16T07:30:00Z",
    exit_code: 0,
    metrics: { "anthropic::complexity_score": 15 },
  };
  const failures = evaluateKpiThresholds(report, [
    { metric: "anthropic::complexity_score", op: "<=", value: 12 },
  ]);
  assert.equal(failures.length, 1);
  assert.match(failures[0]!.reason, /threshold failed/);
});

test("loadKpiReport: schema-validates committed report", () => {
  const ogRoot = getRepoRoot();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-kpi-"));
  copyMissionSchema(path.join(ogRoot, ".gitagent", "teacher"), path.join(root, ".gitagent", "teacher"));
  fs.mkdirSync(path.join(root, ".gitagent", "kpi"), { recursive: true });
  const rel = ".gitagent/kpi/MSN-0028.json";
  fs.writeFileSync(
    path.join(root, rel),
    JSON.stringify({
      msn_id: "MSN-0028",
      generated_at: "2026-06-16T07:30:00Z",
      exit_code: 0,
      metrics: { security_flaws: 0 },
    }),
    "utf8",
  );
  const loaded = loadKpiReport(root, rel);
  assert.equal(loaded.metrics.security_flaws, 0);
});

test("evaluateKpiPhase: missing report fails", () => {
  const ogRoot = getRepoRoot();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-kpi-phase-"));
  copyMissionSchema(path.join(ogRoot, ".gitagent", "teacher"), path.join(root, ".gitagent", "teacher"));
  writeManifest(root, { gapman: { tmvc_roots: ["src/cli/"], forbidden_zones: [], trust_threshold: "Tier-2" } });
  const kpiGate: KpiGateSpec = {
    reportPath: ".gitagent/kpi/MSN-0099.json",
    thresholds: [{ metric: "security_flaws", op: "==", value: 0 }],
  };
  const result = evaluateKpiPhase(root, { schema_version: "0.5.0", skills: {}, path_risks: {}, risk_keywords: [] }, "gapman", kpiGate, {}, "/tmp/WORKER_LOG.md");
  assert.ok(result && "ok" in result && result.ok === false);
  assert.equal(result.phase, "kpi");
});
