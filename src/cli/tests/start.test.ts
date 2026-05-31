import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getRepoRoot } from "../lib/git.js";
import { runStartOrchestration } from "../lib/start-orchestration.js";
import { writeMiniGapmanRepo, gitInitCommit } from "./test-fixtures.js";
import { TEACHER_EMAIL, withTeacherEnv } from "./test-shared.js";

test("runStartOrchestration: scaffolds mission for gapman skill intent", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-start-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "chore: init", TEACHER_EMAIL);
  const prevCwd = process.cwd();
  withTeacherEnv(() => {
    process.chdir(dest);
    try {
      const result = runStartOrchestration({
        intent: "fix ui button component",
        msn: "MSN-0100",
        skillKey: "ui",
      });
      assert.equal(result.ok, true);
      assert.ok(result.mission_file_path?.includes("MSN-0100"));
      assert.ok(fs.existsSync(path.join(dest, result.mission_file_path!)));
    } finally {
      process.chdir(prevCwd);
    }
  });
});
