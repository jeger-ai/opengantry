import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { getRepoRoot } from "#git/git.js";
import { runInit } from "../commands/init.js";
import { runUpgradePlan } from "#missions/upgrade/upgrade-plan.js";
import { loadIntegrationCompat } from "#missions/integration-compat.js";
import { writeSubstrateVersionFile } from "#missions/substrate-version.js";
import {
  assertStableUpgradePlanPayloadV1,
  STABLE_UPGRADE_PLAN_PAYLOAD_VERSION,
  toStableUpgradePlanPayloadV1,
} from "#missions/upgrade/upgrade-plan-payload.js";
import { copyMissionSchema } from "./test-fixtures.js";

const ogRoot = getRepoRoot();
const templatesRoot = path.join(ogRoot, "templates");

async function seedUpgradeRepoForPayloadTest(): Promise<string> {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-stable-upgrade-"));
  execSync("git init", { cwd: dest, stdio: "pipe" });
  const prev = process.cwd();
  process.chdir(dest);
  try {
    await runInit({ force: true, yes: true });
  } finally {
    process.chdir(prev);
  }
  copyMissionSchema(
    path.join(ogRoot, ".gitagent", "planner"),
    path.join(dest, ".gitagent", "planner"),
  );
  writeSubstrateVersionFile(dest, "0.7.0", "test-fixture");
  fs.writeFileSync(path.join(dest, ".cursor/hooks.json"), '{"version":1,"hooks":{"stale":true}}\n', "utf8");
  return dest;
}

test("toStableUpgradePlanPayloadV1: pins schema_version", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-stable-payload-"));
  const bundled = loadIntegrationCompat(templatesRoot).opengantry_version;
  writeSubstrateVersionFile(dest, bundled, "test");
  const result = runUpgradePlan({ repoRoot: dest, templatesRoot, packageName: "@jeger-ai/opengantry", dryRun: true });
  const payload = toStableUpgradePlanPayloadV1(result);
  assert.equal(payload.schema_version, STABLE_UPGRADE_PLAN_PAYLOAD_VERSION);
  assertStableUpgradePlanPayloadV1(payload);
});

test("runUpgradePlan dry-run: stable payload includes file_changes when planned", async () => {
  const dest = await seedUpgradeRepoForPayloadTest();
  const result = runUpgradePlan({ repoRoot: dest, templatesRoot, packageName: "@jeger-ai/opengantry", dryRun: true });
  const payload = toStableUpgradePlanPayloadV1(result);
  assertStableUpgradePlanPayloadV1(payload);
  if (payload.status === "planned") {
    assert.ok(Array.isArray(payload.file_changes));
    for (const change of payload.file_changes ?? []) {
      assert.equal(typeof change.path, "string");
      assert.ok(change.action === "add" || change.action === "update");
    }
  }
});

test("gantry upgrade plan --stage: stages managed files and writes the upgrade mission", async () => {
  const dest = await seedUpgradeRepoForPayloadTest();
  const cli = path.join(ogRoot, "dist/cli/index.js");
  const r = spawnSync("node", [cli, "upgrade", "plan", "--stage", "--json"], { cwd: dest, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const payload = JSON.parse(r.stdout) as { status: string; mission_rel?: string };
  assert.equal(payload.status, "planned");
  assert.ok(payload.mission_rel && fs.existsSync(path.join(dest, payload.mission_rel)), "upgrade mission written");
  assert.ok(fs.existsSync(path.join(dest, ".gitagent", ".upgrade-tmp")), "staging directory written");
  const preview = spawnSync("node", [cli, "upgrade", "plan", "--json"], { cwd: dest, encoding: "utf8" });
  assert.equal(preview.status, 0, preview.stderr);
});
