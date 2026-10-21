import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { getRepoRoot } from "#git/git.js";
import { runInit } from "../commands/init.js";
import { runUpgradePlan } from "#missions/upgrade/upgrade-plan.js";
import { loadIntegrationCompat } from "#missions/integration-compat.js";
import { writeSubstrateVersionFile } from "#missions/substrate-version.js";
import { upgradeEligibleAssets } from "#missions/upgrade/upgrade-plan-catalog.js";
import { resolveAssetsFromProfile } from "#missions/init/init-asset-catalog.js";
import { defaultInitProfile } from "#missions/init/init-profile.js";
import { copyMissionSchema, gitInitCommit } from "./test-fixtures.js";
import { withPlannerEnvAsync, PLANNER_EMAIL } from "./test-shared.js";
import { runUpgradeApply } from "#missions/upgrade/upgrade-apply.js";

const ogRoot = getRepoRoot();
const templatesRoot = path.join(ogRoot, "templates");
const PACKAGE = "@jeger-ai/opengantry";

async function seedUpgradeRepo(): Promise<string> {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-upgrade-"));
  execSync("git init", { cwd: dest, stdio: "pipe" });
  const prev = process.cwd();
  process.chdir(dest);
  try {
    await runInit({ force: true, yes: true });
  } finally {
    process.chdir(prev);
  }
  copyMissionSchema(
    path.join(ogRoot, ".gitagent/planner"),
    path.join(dest, ".gitagent/planner"),
  );
  writeSubstrateVersionFile(dest, "0.7.0", "test-fixture");
  fs.writeFileSync(path.join(dest, ".cursor/hooks.json"), '{"version":1,"hooks":{"stale":true}}\n', "utf8");
  return dest;
}

test("upgradeEligibleAssets: excludes scaffold_only paths", () => {
  const profile = defaultInitProfile();
  const assets = resolveAssetsFromProfile(profile, loadIntegrationCompat(templatesRoot), templatesRoot);
  const eligible = upgradeEligibleAssets(assets);
  const targets = eligible.map((a) => a.targetPath);
  assert.ok(!targets.includes(".gitagent/foreman/MANIFEST.yaml"));
  assert.ok(!targets.includes(".gitagent/planner/RULES.md"));
  assert.ok(targets.includes(".cursor/hooks.json"));
});

test("resolveAssetsFromProfile: default includes SUBSTRATE.version.json", () => {
  const paths = resolveAssetsFromProfile(
    defaultInitProfile(),
    loadIntegrationCompat(templatesRoot),
    templatesRoot,
  ).map((a) => a.targetPath);
  assert.ok(paths.includes(".gitagent/foreman/SUBSTRATE.version.json"));
});

test("runUpgradePlan: already current includes npm guidance", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-upgrade-current-"));
  const bundled = loadIntegrationCompat(templatesRoot).opengantry_version;
  writeSubstrateVersionFile(dest, bundled, "test");
  const result = runUpgradePlan({ repoRoot: dest, templatesRoot, packageName: PACKAGE });
  assert.equal(result.status, "already_current");
  assert.match(result.message ?? "", /npm install @jeger-ai\/opengantry@latest/);
});

test("runUpgradePlan: downgrade blocked", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-upgrade-down-"));
  writeSubstrateVersionFile(dest, "99.0.0", "test");
  const result = runUpgradePlan({ repoRoot: dest, templatesRoot, packageName: PACKAGE });
  assert.equal(result.status, "downgrade_blocked");
});

test("runUpgradePlan: stages files and writes mission YAML without UPGRADE.manifest.json", async () => {
  const dest = await seedUpgradeRepo();
  const result = runUpgradePlan({ repoRoot: dest, templatesRoot, packageName: PACKAGE, msn: "MSN-9001" });
  assert.equal(result.status, "planned");
  assert.ok(result.mission_rel?.includes("MSN-9001.upgrade-v"));
  assert.ok(fs.existsSync(path.join(dest, result.mission_rel!.split("/").join(path.sep))));
  assert.ok(fs.existsSync(path.join(dest, ".gitagent/.upgrade-tmp/.cursor/hooks.json")));
  assert.equal(fs.existsSync(path.join(dest, ".gitagent/.upgrade-tmp/UPGRADE.manifest.json")), false);
  const missionBody = fs.readFileSync(path.join(dest, result.mission_rel!.split("/").join(path.sep)), "utf8");
  assert.match(missionBody, /upgrade_payload:/);
  assert.match(missionBody, /staged_hashes:/);
});

test("runUpgradeApply: blocked without Planner proof", async () => {
  const dest = await seedUpgradeRepo();
  gitInitCommit(dest, "init", PLANNER_EMAIL);
  const plan = runUpgradePlan({ repoRoot: dest, templatesRoot, packageName: PACKAGE, msn: "MSN-9002" });
  const result = await runUpgradeApply({ repoRoot: dest, mission: plan.mission_rel, templatesRoot });
  assert.equal(result.status, "blocked");
});

function commitUpgradeMission(dest: string, missionRel: string, msnId: string): void {
  execSync(`git config user.email "${PLANNER_EMAIL}"`, { cwd: dest, stdio: "pipe" });
  execSync('git config user.name "Fixture"', { cwd: dest, stdio: "pipe" });
  execSync(`git add ${missionRel}`, { cwd: dest, stdio: "pipe" });
  execSync(`git commit -m "[${msnId}] approve upgrade"`, { cwd: dest, stdio: "pipe" });
}

test("runUpgradeApply: succeeds with Planner proof and updates SUBSTRATE", async () => {
  const dest = await seedUpgradeRepo();
  gitInitCommit(dest, "init", PLANNER_EMAIL);
  const plan = runUpgradePlan({ repoRoot: dest, templatesRoot, packageName: PACKAGE, msn: "MSN-9003" });
  commitUpgradeMission(dest, plan.mission_rel!, "MSN-9003");
  let result: Awaited<ReturnType<typeof runUpgradeApply>>;
  await withPlannerEnvAsync(async () => {
    result = await runUpgradeApply({ repoRoot: dest, mission: plan.mission_rel, templatesRoot });
  });
  assert.equal(result!.status, "applied");
  const bundled = loadIntegrationCompat(templatesRoot).opengantry_version;
  const substrate = JSON.parse(
    fs.readFileSync(path.join(dest, ".gitagent/foreman/SUBSTRATE.version.json"), "utf8"),
  ) as { opengantry_version: string };
  assert.equal(substrate.opengantry_version, bundled);
  assert.equal(fs.existsSync(path.join(dest, ".gitagent/.upgrade-tmp")), false);
  const hooks = fs.readFileSync(path.join(dest, ".cursor/hooks.json"), "utf8");
  assert.doesNotMatch(hooks, /stale/);
});

test("runUpgradeApply: legacy repo creates SUBSTRATE.version.json on apply", async () => {
  const dest = await seedUpgradeRepo();
  gitInitCommit(dest, "init", PLANNER_EMAIL);
  fs.unlinkSync(path.join(dest, ".gitagent/foreman/SUBSTRATE.version.json"));
  const plan = runUpgradePlan({ repoRoot: dest, templatesRoot, packageName: PACKAGE, msn: "MSN-9004" });
  commitUpgradeMission(dest, plan.mission_rel!, "MSN-9004");
  await withPlannerEnvAsync(async () => {
    await runUpgradeApply({ repoRoot: dest, mission: plan.mission_rel, templatesRoot });
  });
  assert.ok(fs.existsSync(path.join(dest, ".gitagent/foreman/SUBSTRATE.version.json")));
});

test("runUpgradeApply: hash mismatch fails closed", async () => {
  const dest = await seedUpgradeRepo();
  gitInitCommit(dest, "init", PLANNER_EMAIL);
  const plan = runUpgradePlan({ repoRoot: dest, templatesRoot, packageName: PACKAGE, msn: "MSN-9005" });
  fs.writeFileSync(path.join(dest, ".gitagent/.upgrade-tmp/.cursor/hooks.json"), '{"tampered":true}\n', "utf8");
  commitUpgradeMission(dest, plan.mission_rel!, "MSN-9005");
  await assert.rejects(
    async () =>
      withPlannerEnvAsync(async () => {
        await runUpgradeApply({ repoRoot: dest, mission: plan.mission_rel, templatesRoot });
      }),
    (e: unknown) => e instanceof Error && e.message.includes("hash mismatch"),
  );
});

test("runUpgradeApply: rejects mission with unknown top-level fields", async () => {
  const dest = await seedUpgradeRepo();
  const missionRel = ".gitagent/missions/MSN-9010.upgrade-bad.yaml";
  const missionAbs = path.join(dest, missionRel.split("/").join(path.sep));
  fs.mkdirSync(path.dirname(missionAbs), { recursive: true });
  fs.writeFileSync(
    missionAbs,
    `msn_id: MSN-9010
skill_key: substrate
gate_command: gantry doctor
unknown_field: true
upgrade_payload:
  from_version: "0.7.0"
  to_version: "2.1.0"
  staged_root: .gitagent/.upgrade-tmp
  planned_writes: []
  skipped_scaffold_only: []
  staged_hashes: {}
  created_at: "2026-01-01T00:00:00.000Z"
trace_rows: []
`,
    "utf8",
  );
  await assert.rejects(
    async () => runUpgradeApply({ repoRoot: dest, mission: missionRel, templatesRoot }),
    (e: unknown) => e instanceof Error && /GXT_MISSION_SCHEMA_INVALID/.test(e.message),
  );
});
