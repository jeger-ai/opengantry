import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getRepoRoot } from "../lib/git.js";
import { runKpiScan, verifierOutputSucceeded } from "../lib/kpi-scan.js";
import type { ParsedMission } from "../lib/types.js";
import { copyMissionSchema } from "./test-fixtures.js";

function missionWithVerifiers(root: string): ParsedMission {
  const scriptPath = path.join(root, "verifier-a.sh");
  fs.writeFileSync(
    scriptPath,
    `#!/bin/sh
echo '{"metrics":{"complexity_score":3},"exit_code":0}'
`,
    "utf8",
  );
  fs.chmodSync(scriptPath, 0o755);
  return {
    msnId: "MSN-0030",
    skillKey: "gapman",
    gate: { command: "echo OK", successSubstring: null },
    kpiGate: { reportPath: ".gitagent/kpi/MSN-0030.json", thresholds: [] },
    virtualCapture: false,
    llmVerifiers: [{ id: "anthropic", command: scriptPath, required: true }],
    aggregators: [{ key: "security_flaws", op: "max", sources: ["anthropic::complexity_score"] }],
    traceRows: [],
    rawPath: path.join(root, ".gitagent/missions/m.yaml"),
  };
}

test("runKpiScan: namespaces metrics and applies aggregators", () => {
  const ogRoot = getRepoRoot();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-scan-"));
  copyMissionSchema(path.join(ogRoot, ".gitagent", "teacher"), path.join(root, ".gitagent", "teacher"));
  const mission = missionWithVerifiers(root);
  const result = runKpiScan(root, mission);
  assert.equal(result.reportPath, ".gitagent/kpi/MSN-0030.json");
  assert.equal(result.report.metrics["anthropic::complexity_score"], 3);
  assert.equal(result.report.metrics["anthropic::__verifier_ok"], true);
  assert.equal(result.report.metrics.security_flaws, 3);
  assert.ok(fs.existsSync(path.join(root, ".gitagent/kpi/MSN-0030.json")));
});

test("runKpiScan: required verifier failure throws", () => {
  const ogRoot = getRepoRoot();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-scan-fail-"));
  copyMissionSchema(path.join(ogRoot, ".gitagent", "teacher"), path.join(root, ".gitagent", "teacher"));
  const mission = missionWithVerifiers(root);
  mission.llmVerifiers[0]!.command = "exit 1";
  assert.throws(() => runKpiScan(root, mission), /required verifier/);
});

test("verifierOutputSucceeded: requires exit 0 and non-empty metrics", () => {
  assert.equal(verifierOutputSucceeded(0, { metrics: { score: 1 } }), true);
  assert.equal(verifierOutputSucceeded(0, { metrics: {} }), false);
  assert.equal(verifierOutputSucceeded(1, { metrics: { score: 1 } }), false);
  assert.equal(verifierOutputSucceeded(0, {}), false);
});

test("runKpiScan: optional verifier failure writes __verifier_ok false", () => {
  const ogRoot = getRepoRoot();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-scan-optional-"));
  copyMissionSchema(path.join(ogRoot, ".gitagent", "teacher"), path.join(root, ".gitagent", "teacher"));
  const mission = missionWithVerifiers(root);
  mission.llmVerifiers.push({ id: "optional", command: "exit 1", required: false });
  const result = runKpiScan(root, mission);
  assert.equal(result.report.metrics["optional::__verifier_ok"], false);
  assert.equal(result.report.metrics["anthropic::__verifier_ok"], true);
});

test("runKpiScan: tolerates trailing whitespace in verifier stdout", () => {
  const ogRoot = getRepoRoot();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-scan-trim-"));
  copyMissionSchema(path.join(ogRoot, ".gitagent", "teacher"), path.join(root, ".gitagent", "teacher"));
  const scriptPath = path.join(root, "verifier-trim.sh");
  fs.writeFileSync(
    scriptPath,
    `#!/bin/sh
printf '{"metrics":{"complexity_score":5},"exit_code":0}\\n\\n'
`,
    "utf8",
  );
  fs.chmodSync(scriptPath, 0o755);
  const mission: ParsedMission = {
    msnId: "MSN-0031",
    skillKey: "gapman",
    gate: { command: "echo OK", successSubstring: null },
    kpiGate: { reportPath: ".gitagent/kpi/MSN-0031.json", thresholds: [] },
    virtualCapture: false,
    llmVerifiers: [{ id: "trim", command: scriptPath, required: true }],
    aggregators: [],
    traceRows: [],
    rawPath: path.join(root, ".gitagent/missions/m.yaml"),
  };
  const result = runKpiScan(root, mission);
  assert.equal(result.report.metrics["trim::complexity_score"], 5);
});
