import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getRepoRoot } from "../lib/git.js";
import { runVerifyCore } from "../lib/verify-run.js";
import { gitInitCommit, writeMiniGapmanMission, writeMiniGapmanRepo } from "./test-fixtures.js";
import { PLANNER_EMAIL, withPlannerEnvAsync } from "./test-shared.js";

test("runVerifyCore: returns typed result without setting process.exitCode on success", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-run-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      const result = await runVerifyCore({
        mission: ".gitagent/missions/m.yaml",
        executorLog: "EXECUTOR_LOG.md",
      });
      assert.equal(result.ok, true);
      assert.equal(result.exitCode, 0);
      assert.equal(process.exitCode, undefined, "runVerifyCore must not set process.exitCode");
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});

test("runVerifyCore: returns failure exit code for gate failure", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-run-gate-"));
  writeMiniGapmanRepo(dest, ogRoot);
  writeMiniGapmanMission(dest, "MSN-0999", "evidence A", `bash -lc "exit 1"`, "DONE", "m.yaml");
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      const result = await runVerifyCore({
        mission: ".gitagent/missions/m.yaml",
        executorLog: "EXECUTOR_LOG.md",
      });
      assert.equal(result.ok, false);
      assert.equal(result.exitCode, 1);
      assert.equal(process.exitCode, undefined, "runVerifyCore must not set process.exitCode");
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});
