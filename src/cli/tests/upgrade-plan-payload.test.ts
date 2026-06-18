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
import {
  assertStableUpgradePlanPayloadV1,
  STABLE_UPGRADE_PLAN_PAYLOAD_VERSION,
  toStableUpgradePlanPayloadV1,
} from "../lib/upgrade-plan-payload.js";
import { handleUpgradePlan } from "../lib/mcp-upgrade.js";
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
    path.join(ogRoot, ".gitagent", "teacher"),
    path.join(dest, ".gitagent", "teacher"),
  );
  writeSubstrateVersionFile(dest, "0.7.0", "test-fixture");
  fs.writeFileSync(path.join(dest, ".cursor/hooks.json"), '{"version":1,"hooks":{"stale":true}}\n', "utf8");
  return dest;
}

test("toStableUpgradePlanPayloadV1: pins schema_version", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-stable-payload-"));
  const bundled = loadIntegrationCompat(templatesRoot).opengantry_version;
  writeSubstrateVersionFile(dest, bundled, "test");
  const result = runUpgradePlan({ repoRoot: dest, templatesRoot, dryRun: true, json: true });
  const payload = toStableUpgradePlanPayloadV1(result);
  assert.equal(payload.schema_version, STABLE_UPGRADE_PLAN_PAYLOAD_VERSION);
  assertStableUpgradePlanPayloadV1(payload);
});

test("runUpgradePlan dry-run: stable payload includes file_changes when planned", async () => {
  const dest = await seedUpgradeRepoForPayloadTest();
  const result = runUpgradePlan({ repoRoot: dest, templatesRoot, dryRun: true, json: true });
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

test("mcp upgrade plan: returns stable payload envelope", () => {
  const result = handleUpgradePlan({ dry_run: true });
  if ("error" in result) {
    assert.ok(result.error.code);
    return;
  }
  assert.equal(result.schema_version, STABLE_UPGRADE_PLAN_PAYLOAD_VERSION);
  assertStableUpgradePlanPayloadV1(result);
});
