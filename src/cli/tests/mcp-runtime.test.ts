import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getRepoRoot } from "../lib/git.js";
import { handleVerify } from "../lib/mcp-runtime.js";
import { writeMiniGapmanRepo, writeMiniGapmanMission, gitInitCommit } from "./test-fixtures.js";
import { PLANNER_EMAIL, withPlannerEnv } from "./test-shared.js";

test("handleVerify: gate failure includes fix_hints and error_code", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-mcp-verify-"));
  writeMiniGapmanRepo(dest, ogRoot);
  writeMiniGapmanMission(dest, "MSN-0999", "evidence A", `bash -lc "exit 1"`, "DONE", "m.yaml");
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  withPlannerEnv(() => {
    process.chdir(dest);
    try {
      const result = handleVerify(".gitagent/missions/m.yaml");
      assert.equal(result.status, "failed");
      assert.equal(result.phase, "gate");
      assert.equal(result.error_code, "GXT_GATE_FAILED");
      assert.ok(Array.isArray(result.fix_hints));
      assert.ok((result.fix_hints as string[]).length > 0);
    } finally {
      process.chdir(prevCwd);
    }
  });
});
