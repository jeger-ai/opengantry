import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import { evaluateDefensiveGuards } from "../lib/defensive-guard.js";
import { evaluateDefensiveGuardPhase } from "../lib/verify-defensive-phase.js";
import { buildDefensiveProfileFromPreset } from "../lib/defensive-profile-presets.js";
import { gitInitCommit } from "./test-fixtures.js";
import { PLANNER_EMAIL } from "./test-shared.js";
import type { Manifest } from "../lib/types.js";

const MANIFEST: Manifest = {
  schema_version: "0.5.0",
  skills: {
    gantry: {
      desc: "test",
      trust_threshold: "Tier-2",
      tmvc_roots: ["src/"],
      forbidden_zones: [],
    },
  },
  path_risks: {},
  risk_keywords: [],
  perimeter_protected: [],
};

function writeConfig(dest: string, defensiveProfile: unknown): void {
  fs.mkdirSync(path.join(dest, ".gitagent"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, ".gitagent/config.json"),
    JSON.stringify({ defensive_profile: defensiveProfile }, null, 2),
    "utf8",
  );
}

function initRepoWithFiles(files: Record<string, string>): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-def-guard-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dest, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, "utf8");
  }
  gitInitCommit(dest, "init", PLANNER_EMAIL);
  return dest;
}

function stageNewFiles(repo: string, relPaths: string[]): void {
  if (relPaths.length === 0) return;
  execSync(`git add -- ${relPaths.map((p) => JSON.stringify(p)).join(" ")}`, { cwd: repo });
}

test("evaluateDefensiveGuards: file_scope blocks strict preset", () => {
  const repo = initRepoWithFiles({ "src/a.ts": "a\n", "src/b.ts": "b\n" });
  writeConfig(repo, buildDefensiveProfileFromPreset("strict_enterprise"));
  const newPaths: string[] = [];
  for (let i = 0; i < 20; i++) {
    const rel = `src/f${i}.ts`;
    fs.writeFileSync(path.join(repo, rel), "x\n", "utf8");
    newPaths.push(rel);
  }
  stageNewFiles(repo, newPaths);
  const result = evaluateDefensiveGuards(repo, MANIFEST, "gantry");
  assert.equal(result.ok, false);
  assert.ok(result.blocked.some((f) => f.guard === "file_scope"));
});

test("evaluateDefensiveGuards: balanced_partner warns without blocking", () => {
  const repo = initRepoWithFiles({ "src/a.ts": "a\n" });
  writeConfig(repo, buildDefensiveProfileFromPreset("balanced_partner"));
  const newPaths: string[] = [];
  for (let i = 0; i < 30; i++) {
    const rel = `src/f${i}.ts`;
    fs.writeFileSync(path.join(repo, rel), "x\n", "utf8");
    newPaths.push(rel);
  }
  stageNewFiles(repo, newPaths);
  const result = evaluateDefensiveGuards(repo, MANIFEST, "gantry");
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((f) => f.guard === "file_scope"));
});

test("evaluateDefensiveGuards: lean_scratchpad audits only", () => {
  const repo = initRepoWithFiles({ "src/a.ts": "a\n" });
  writeConfig(repo, buildDefensiveProfileFromPreset("lean_scratchpad"));
  const newPaths: string[] = [];
  for (let i = 0; i < 50; i++) {
    const rel = `src/f${i}.ts`;
    fs.writeFileSync(path.join(repo, rel), "x\n", "utf8");
    newPaths.push(rel);
  }
  stageNewFiles(repo, newPaths);
  const result = evaluateDefensiveGuards(repo, MANIFEST, "gantry");
  assert.equal(result.ok, true);
  assert.ok(result.audits.some((f) => f.guard === "file_scope"));
  assert.equal(result.warnings.length, 0);
});

test("evaluateDefensiveGuardPhase: audit-severity net_loc overflow does NOT fail verify (lean_scratchpad)", () => {
  const repo = initRepoWithFiles({ "src/a.ts": "a\n" });
  writeConfig(repo, buildDefensiveProfileFromPreset("lean_scratchpad"));
  // lean_scratchpad max_net_loc is 800; one 900-line file overflows the budget at audit severity.
  const bigBody = Array.from({ length: 900 }, (_, i) => `export const v${i} = ${i};`).join("\n");
  fs.writeFileSync(path.join(repo, "src/big.ts"), `${bigBody}\n`, "utf8");
  stageNewFiles(repo, ["src/big.ts"]);
  const outcome = evaluateDefensiveGuardPhase(repo, MANIFEST, "gantry", "EXECUTOR_LOG.md");
  assert.equal(outcome.failure, null);
  assert.ok(outcome.audits.some((msg) => msg.includes("net_loc_budget")));
});

test("evaluateDefensiveGuardPhase: unknown skill is a hard error, not a finding", () => {
  const repo = initRepoWithFiles({ "src/a.ts": "a\n" });
  writeConfig(repo, buildDefensiveProfileFromPreset("lean_scratchpad"));
  const outcome = evaluateDefensiveGuardPhase(repo, MANIFEST, "no-such-skill", "EXECUTOR_LOG.md");
  assert.ok(outcome.failure);
  assert.match(outcome.failure.message, /unknown skill no-such-skill/);
});

test("evaluateDefensiveGuards: test_to_code detects assertion erosion", () => {
  const repo = initRepoWithFiles({
    "src/logic.ts": "export const x = 1;\n",
    "src/logic.test.ts": "import assert from 'node:assert';\nassert.equal(1,1);\n",
  });
  const profile = buildDefensiveProfileFromPreset("strict_enterprise");
  writeConfig(repo, profile);
  fs.writeFileSync(
    path.join(repo, "src/logic.ts"),
    "export const x = 1;\nexport const y = 2;\nexport const z = 3;\n",
    "utf8",
  );
  fs.writeFileSync(path.join(repo, "src/logic.test.ts"), "import assert from 'node:assert';\n", "utf8");
  execSync("git add src/logic.ts src/logic.test.ts", { cwd: repo });
  const result = evaluateDefensiveGuards(repo, MANIFEST, "gantry");
  assert.equal(result.ok, false);
  assert.ok(result.blocked.some((f) => f.guard === "test_to_code"));
});
