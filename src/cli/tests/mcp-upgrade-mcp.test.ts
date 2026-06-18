import test from "node:test";
import assert from "node:assert/strict";
import { handleUpgradePlan } from "../lib/mcp-upgrade.js";
import {
  assertStableUpgradePlanPayloadV1,
  STABLE_UPGRADE_PLAN_PAYLOAD_VERSION,
} from "../lib/upgrade-plan-payload.js";

test("mcp upgrade plan: returns stable payload envelope", () => {
  const result = handleUpgradePlan({ dry_run: true });
  if ("error" in result) {
    assert.ok(result.error.code);
    return;
  }
  assert.equal(result.schema_version, STABLE_UPGRADE_PLAN_PAYLOAD_VERSION);
  assertStableUpgradePlanPayloadV1(result);
  assert.ok("from_version" in result);
  assert.ok("to_version" in result);
  if (result.status === "planned" && result.file_changes) {
    assert.ok(Array.isArray(result.file_changes));
  }
});
