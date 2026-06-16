import test from "node:test";
import assert from "node:assert/strict";
import { handleUpgradePlan } from "../lib/mcp-upgrade.js";

test("mcp upgrade plan: returns typed UpgradePlanResult shape", () => {
  const result = handleUpgradePlan({ dry_run: true });
  if (result.status === "error") {
    assert.ok(result.error.code);
    return;
  }
  assert.ok("from_version" in result);
  assert.ok("to_version" in result);
  if (result.status === "planned" && result.file_changes) {
    assert.ok(Array.isArray(result.file_changes));
  }
});
