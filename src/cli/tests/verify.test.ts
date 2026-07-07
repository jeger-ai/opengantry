import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import { getRepoRoot } from "../lib/git.js";
import { runVerify } from "../commands/verify.js";
import {
  writeMiniGapmanRepo,
  writeMiniGapmanMission,
  gitInitCommit,
} from "./test-fixtures.js";
import { PLANNER_EMAIL, withPlannerEnvAsync } from "./test-shared.js";

test("runVerify: passes with Planner git-proof in mini repo", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      await runVerify({ mission: ".gitagent/missions/m.yaml", executorLog: "EXECUTOR_LOG.md" });
      assert.equal(process.exitCode, undefined, "exitCode should not be set on success");
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});


test("runVerify: gate failure sets exit code 1", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-gate-"));
  writeMiniGapmanRepo(dest, ogRoot);
  writeMiniGapmanMission(dest, "MSN-0999", "evidence A", `bash -lc "exit 1"`, "DONE", "m.yaml");
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      await runVerify({ mission: ".gitagent/missions/m.yaml", executorLog: "EXECUTOR_LOG.md" });
      assert.equal(process.exitCode, 1);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});


test("runVerify: trace mapping failure sets exit code 1", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-trace-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  fs.writeFileSync(path.join(dest, "EXECUTOR_LOG.md"), "wrong evidence\n", "utf8");
  const prevCwd = process.cwd();
  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      await runVerify({ mission: ".gitagent/missions/m.yaml", executorLog: "EXECUTOR_LOG.md" });
      assert.equal(process.exitCode, 1);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});

test("runVerify: git-proof uses Planner commit author from history, not CI runner identity", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-ci-runner-"));
  writeMiniGapmanRepo(dest, ogRoot);
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, ".gitagent", "foreman", "PLANNER.allowlist"),
    `${PLANNER_EMAIL}\n`,
    "utf8",
  );
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  const prevName = process.env.GIT_AUTHOR_NAME;
  const prevEmail = process.env.GIT_AUTHOR_EMAIL;
  const prevConfigEmail = execSync("git config user.email || true", { cwd: dest, encoding: "utf8" }).trim();
  try {
    execSync('git config user.email "github-actions[bot]@users.noreply.github.com"', { cwd: dest });
    process.env.GIT_AUTHOR_NAME = "github-actions[bot]";
    process.env.GIT_AUTHOR_EMAIL = "github-actions[bot]@users.noreply.github.com";
    process.chdir(dest);
    process.exitCode = undefined;
    await runVerify({ mission: ".gitagent/missions/m.yaml", executorLog: "EXECUTOR_LOG.md" });
    assert.equal(process.exitCode, undefined, "verify must pass when Planner stamp is in history");
  } finally {
    process.chdir(prevCwd);
    if (prevConfigEmail) {
      execSync(`git config user.email "${prevConfigEmail}"`, { cwd: dest });
    }
    process.env.GIT_AUTHOR_NAME = prevName;
    process.env.GIT_AUTHOR_EMAIL = prevEmail;
    process.exitCode = undefined;
  }
});
