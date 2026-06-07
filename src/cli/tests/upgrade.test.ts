import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { getRepoRoot } from "../lib/git.js";
import { runInit } from "../commands/init.js";
import { runUpgradePlan } from "../lib/upgrade-plan.js";
import { loadIntegrationCompat } from "../lib/integration-compat.js";
import { writeSubstrateVersionFile } from "../lib/substrate-version.js";
import { upgradeEligibleAssets } from "../lib/upgrade-eligible-assets.js";
import { resolveAssetsFromProfile, legacyDefaultInitTargetPaths } from "../lib/init-asset-catalog.js";
import { defaultInitProfile } from "../lib/init-profile.js";
import { copyMissionSchema, gitInitCommit } from "./test-fixtures.js";
import { withTeacherEnvAsync } from "./test-shared.js";
import { runUpgradeApply } from "../lib/upgrade-apply.js";
import { TEACHER_EMAIL } from "./test-shared.js";

const ogRoot = getRepoRoot();
const templatesRoot = path.join(ogRoot, "templates");

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
    path.join(ogRoot, ".gitagent/teacher"),
    path.join(dest, ".gitagent/teacher"),
  );
  writeSubstrateVersionFile(dest, "0.7.0", "test-fixture");
  fs.writeFileSync(path.join(dest, ".cursor/hooks.json"), '{"version":1,"hooks":{"stale":true}}\n', "utf8");
  return dest;
}

test("upgradeEligibleAssets: excludes scaffold_only paths", () => {
  const profile = defaultInitProfile();
  const assets = resolveAssetsFromProfile(profile, loadIntegrationCompat(templatesRoot));
  const eligible = upgradeEligibleAssets(assets);
  const targets = eligible.map((a) => a.targetPath);
  assert.ok(!targets.includes(".gitagent/foreman/MANIFEST.json"));
  assert.ok(!targets.includes(".gitagent/teacher/RULES.md"));
  assert.ok(targets.includes(".cursor/hooks.json"));
});

test("legacyDefaultInitTargetPaths: includes SUBSTRATE.version.json", () => {
  const paths = legacyDefaultInitTargetPaths();
  assert.ok(paths.includes(".gitagent/foreman/SUBSTRATE.version.json"));
});

test("runUpgradePlan: already current includes npm guidance", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-upgrade-current-"));
  const bundled = loadIntegrationCompat(templatesRoot).opengantry_version;
  writeSubstrateVersionFile(dest, bundled, "test");
  const result = runUpgradePlan({ repoRoot: dest, templatesRoot, json: true });
  assert.equal(result.status, "already_current");
  assert.match(result.message ?? "", /npm install @jeger-ai\/opengantry@latest/);
});

test("runUpgradePlan: downgrade blocked", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-upgrade-down-"));
  writeSubstrateVersionFile(dest, "99.0.0", "test");
  const result = runUpgradePlan({ repoRoot: dest, templatesRoot, json: true });
  assert.equal(result.status, "downgrade_blocked");
});

test("runUpgradePlan: stages files and writes mission YAML without UPGRADE.manifest.json", async () => {
  const dest = await seedUpgradeRepo();
  const result = runUpgradePlan({ repoRoot: dest, templatesRoot, msn: "MSN-9001", json: true });
  assert.equal(result.status, "planned");
  assert.ok(result.mission_rel?.includes("MSN-9001.upgrade-v"));
  assert.ok(fs.existsSync(path.join(dest, result.mission_rel!.split("/").join(path.sep))));
  assert.ok(fs.existsSync(path.join(dest, ".gitagent/.upgrade-tmp/.cursor/hooks.json")));
  assert.equal(fs.existsSync(path.join(dest, ".gitagent/.upgrade-tmp/UPGRADE.manifest.json")), false);
  const missionBody = fs.readFileSync(path.join(dest, result.mission_rel!.split("/").join(path.sep)), "utf8");
  assert.match(missionBody, /upgrade_payload:/);
  assert.match(missionBody, /staged_hashes:/);
});

test("runUpgradeApply: blocked without Teacher proof", async () => {
  const dest = await seedUpgradeRepo();
  gitInitCommit(dest, "init", TEACHER_EMAIL);
  const plan = runUpgradePlan({ repoRoot: dest, templatesRoot, msn: "MSN-9002", json: true });
  const result = await runUpgradeApply({ repoRoot: dest, mission: plan.mission_rel, json: true });
  assert.equal(result.status, "blocked");
});

function commitUpgradeMission(dest: string, missionRel: string, msnId: string): void {
  execSync(`git config user.email "${TEACHER_EMAIL}"`, { cwd: dest, stdio: "pipe" });
  execSync('git config user.name "Fixture"', { cwd: dest, stdio: "pipe" });
  execSync(`git add ${missionRel}`, { cwd: dest, stdio: "pipe" });
  execSync(`git commit -m "[${msnId}] approve upgrade"`, { cwd: dest, stdio: "pipe" });
}

test("runUpgradeApply: succeeds with Teacher proof and updates SUBSTRATE", async () => {
  const dest = await seedUpgradeRepo();
  gitInitCommit(dest, "init", TEACHER_EMAIL);
  const plan = runUpgradePlan({ repoRoot: dest, templatesRoot, msn: "MSN-9003", json: true });
  commitUpgradeMission(dest, plan.mission_rel!, "MSN-9003");
  let result: Awaited<ReturnType<typeof runUpgradeApply>>;
  await withTeacherEnvAsync(async () => {
    result = await runUpgradeApply({ repoRoot: dest, mission: plan.mission_rel, templatesRoot, json: true });
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
  gitInitCommit(dest, "init", TEACHER_EMAIL);
  fs.unlinkSync(path.join(dest, ".gitagent/foreman/SUBSTRATE.version.json"));
  const plan = runUpgradePlan({ repoRoot: dest, templatesRoot, msn: "MSN-9004", json: true });
  commitUpgradeMission(dest, plan.mission_rel!, "MSN-9004");
  await withTeacherEnvAsync(async () => {
    await runUpgradeApply({ repoRoot: dest, mission: plan.mission_rel, templatesRoot, json: true });
  });
  assert.ok(fs.existsSync(path.join(dest, ".gitagent/foreman/SUBSTRATE.version.json")));
});

test("runUpgradeApply: hash mismatch fails closed", async () => {
  const dest = await seedUpgradeRepo();
  gitInitCommit(dest, "init", TEACHER_EMAIL);
  const plan = runUpgradePlan({ repoRoot: dest, templatesRoot, msn: "MSN-9005", json: true });
  fs.writeFileSync(path.join(dest, ".gitagent/.upgrade-tmp/.cursor/hooks.json"), '{"tampered":true}\n', "utf8");
  commitUpgradeMission(dest, plan.mission_rel!, "MSN-9005");
  await assert.rejects(
    async () =>
      withTeacherEnvAsync(async () => {
        await runUpgradeApply({ repoRoot: dest, mission: plan.mission_rel, templatesRoot, json: true });
      }),
    (e: unknown) => e instanceof Error && e.message.includes("hash mismatch"),
  );
});
