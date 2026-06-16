import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getRepoRoot } from "../lib/git.js";
import { runKpiScan } from "../lib/kpi-scan.js";
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
