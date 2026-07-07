import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { verifyKpiReportFreshness } from "../lib/kpi-engine.js";
import { copyMissionSchema, gitInitCommit, writeManifest, writeSkillsForManifest } from "./test-fixtures.js";

const TEACHER = "teacher@example.com";

function gitCommitAll(dest: string, subject: string): void {
  execFileSync("git", ["add", "-A"], { cwd: dest, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", subject], { cwd: dest, stdio: "pipe" });
}

function writeMiniRepoWithKpi(dest: string, ogRoot: string): void {
  copyMissionSchema(path.join(ogRoot, ".gitagent", "planner"), path.join(dest, ".gitagent", "planner"));
  writeManifest(dest, {
    gapman: {
      trust_threshold: "Tier-2",
      tmvc_roots: ["src/app/"],
      forbidden_zones: [],
    },
  });
  writeSkillsForManifest(dest, ["gapman"]);
  fs.mkdirSync(path.join(dest, "src", "app"), { recursive: true });
  fs.mkdirSync(path.join(dest, ".gitagent", "kpi"), { recursive: true });
  fs.writeFileSync(path.join(dest, "src", "app", "main.ts"), "export const v = 1;\n", "utf8");
  fs.writeFileSync(
    path.join(dest, ".gitagent", "kpi", "MSN-0099.json"),
    JSON.stringify(
      {
        msn_id: "MSN-0099",
        generated_at: "2026-06-16T08:00:00.000Z",
        exit_code: 0,
        metrics: { security_flaws: 0 },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

function loadManifest(dest: string) {
  return JSON.parse(
    fs.readFileSync(path.join(dest, ".gitagent", "foreman", "MANIFEST.json"), "utf8"),
  );
}

test("verifyKpiReportFreshness: no TMVC drift after attestation passes", () => {
  const ogRoot = process.cwd();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-kpi-stale-clean-"));
  writeMiniRepoWithKpi(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] init", TEACHER);
  const manifest = loadManifest(dest);
  const result = verifyKpiReportFreshness(dest, manifest, "gapman", ".gitagent/kpi/MSN-0099.json");
  assert.equal(result.stale, false);
  assert.equal(result.advisoryOnly, false);
});

test("verifyKpiReportFreshness: partial KPI refresh uses latest report commit attestation", () => {
  const ogRoot = process.cwd();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-kpi-stale-refresh-"));
  writeMiniRepoWithKpi(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] init", TEACHER);
  const kpiPath = path.join(dest, ".gitagent", "kpi", "MSN-0099.json");
  const raw = JSON.parse(fs.readFileSync(kpiPath, "utf8")) as Record<string, unknown>;
  raw.generated_at = "2026-06-16T09:00:00.000Z";
  fs.writeFileSync(kpiPath, JSON.stringify(raw, null, 2) + "\n", "utf8");
  gitCommitAll(dest, "[MSN-0999] refresh generated_at only");
  const manifest = loadManifest(dest);
  const result = verifyKpiReportFreshness(dest, manifest, "gapman", ".gitagent/kpi/MSN-0099.json");
  assert.equal(result.stale, false);
  assert.ok(result.attestationCommit);
});

test("verifyKpiReportFreshness: uncommitted TMVC drift is advisory only", () => {
  const ogRoot = process.cwd();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-kpi-stale-advisory-"));
  writeMiniRepoWithKpi(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] init", TEACHER);
  fs.writeFileSync(path.join(dest, "src", "app", "main.ts"), "export const v = 2;\n", "utf8");
  const manifest = loadManifest(dest);
  const result = verifyKpiReportFreshness(dest, manifest, "gapman", ".gitagent/kpi/MSN-0099.json", {
    strictStale: false,
  });
  assert.equal(result.stale, false);
  assert.equal(result.advisoryOnly, true);
  assert.match(result.reason ?? "", /TMVC drift since scan/);
});

test("verifyKpiReportFreshness: committed TMVC drift fails strict stale", () => {
  const ogRoot = process.cwd();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-kpi-stale-strict-"));
  writeMiniRepoWithKpi(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] init", TEACHER);
  fs.writeFileSync(path.join(dest, "src", "app", "main.ts"), "export const v = 3;\n", "utf8");
  gitCommitAll(dest, "[MSN-0999] tmvc drift without rescan");
  const manifest = loadManifest(dest);
  const result = verifyKpiReportFreshness(dest, manifest, "gapman", ".gitagent/kpi/MSN-0099.json", {
    strictStale: true,
  });
  assert.equal(result.stale, true);
  assert.equal(result.advisoryOnly, false);
  assert.ok(result.stalePaths.some((p) => p.includes("src/app/main.ts")));
});
