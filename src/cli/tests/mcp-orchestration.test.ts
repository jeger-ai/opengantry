import test from "node:test";
import assert from "node:assert/strict";
import { handleStartOrchestration } from "../lib/mcp-governance.js";

test("mcp orchestration: typed ok result", () => {
  const result = handleStartOrchestration({
    intent: "gapman verify helper",
    msn_id: "MSN-9999",
    skill_key: "gapman",
    gate_command: "echo OK",
    write_mission: false,
  });
  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.triage.confidence, 1);
    assert.ok(result.triage.match_reasons.length > 0);
    assert.ok(result.resolve.status === "unpinned" || result.resolve.status === "resolved");
  }
});
