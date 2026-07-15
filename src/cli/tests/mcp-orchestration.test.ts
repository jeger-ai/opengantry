import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getRepoRoot } from "../lib/git.js";
import { handleStartOrchestration } from "../lib/mcp-governance.js";
import { writeMiniGantryRepo, gitInitCommit } from "./test-fixtures.js";
import { PLANNER_EMAIL } from "./test-shared.js";

test("mcp orchestration: typed ok result", () => {
  const result = handleStartOrchestration({
    intent: "gantry verify helper",
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

test("mcp orchestration: invalid msn_id fails with exit_code 2 and no mission path", () => {
  const result = handleStartOrchestration({
    intent: "gantry verify helper",
    msn_id: "MSN-BAD",
    skill_key: "gapman",
    gate_command: "echo OK",
    write_mission: false,
  });
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.exit_code, 2);
    assert.equal(result.msn_id, null);
    assert.equal(result.mission_file_path, null);
  }
});

test("mcp orchestration: duplicate MSN scaffold fails with fresh-MSN next actions", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-mcp-orch-dup-"));
  writeMiniGantryRepo(dest, getRepoRoot());
  gitInitCommit(dest, "chore: init", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  process.chdir(dest);
  try {
    // m.yaml in the fixture already occupies MSN-0999.
    const result = handleStartOrchestration({
      intent: "duplicate mission attempt",
      msn_id: "MSN-0999",
      skill_key: "ui",
      gate_command: "echo OK",
      write_mission: true,
    });
    assert.equal(result.status, "failed");
    if (result.status === "failed") {
      assert.equal(result.exit_code, 2);
      assert.equal(result.mission_file_path, null);
      assert.ok(result.next_actions.some((step) => step.includes("--allow-duplicate")));
    }
  } finally {
    process.chdir(prevCwd);
  }
});
