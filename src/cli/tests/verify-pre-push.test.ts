import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getRepoRoot } from "../lib/git.js";
import { LEGISLATE_TRACE_PLACEHOLDER } from "../lib/constants.js";
import { runVerify } from "../commands/verify.js";
import {
  writeMiniGapmanRepo,
  writeMiniGapmanMission,
  gitInitCommit,
} from "./test-fixtures.js";
import { captureConsoleAsync, PLANNER_EMAIL, withPlannerEnvAsync } from "./test-shared.js";

test("runVerify: --pre-push passes legislative stub after git-proof", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-pre-push-stub-"));
  writeMiniGapmanRepo(dest, ogRoot);
  writeMiniGapmanMission(dest, "MSN-0999", LEGISLATE_TRACE_PLACEHOLDER, "echo OK", "OK", "stub.yaml");
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      const { output } = await captureConsoleAsync(async () => {
        await runVerify({ mission: ".gitagent/missions/stub.yaml", prePush: true });
      });
      assert.equal(process.exitCode, undefined);
      assert.match(output.stdout, /legislative stub OK/);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});

test("runVerify: --pre-push fails unlegislated stub with NO_MSN_COMMITS", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-pre-push-nostamp-"));
  writeMiniGapmanRepo(dest, ogRoot);
  writeMiniGapmanMission(dest, "MSN-0999", LEGISLATE_TRACE_PLACEHOLDER, "echo OK", "OK", "stub.yaml");
  gitInitCommit(dest, "chore: add stub without planner stamp", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      await captureConsoleAsync(async () => {
        await runVerify({ mission: ".gitagent/missions/stub.yaml", prePush: true });
      });
      assert.equal(process.exitCode, 1);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});

test("runVerify: --pre-push runs full verify when execution claimed", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-pre-push-full-"));
  writeMiniGapmanRepo(dest, ogRoot);
  writeMiniGapmanMission(dest, "MSN-0999", "mission-only trace quote", "echo OK", "OK", "exec.yaml");
  fs.writeFileSync(path.join(dest, "EXECUTOR_LOG.md"), "unrelated executor evidence\n");
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      await runVerify({ mission: ".gitagent/missions/exec.yaml", prePush: true });
      assert.equal(process.exitCode, 1, "trace mapping should fail");
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});

test("runVerify: full verify fails when trace rows still PENDING", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-pending-"));
  writeMiniGapmanRepo(dest, ogRoot);
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, ".gitagent", "missions", "pending.yaml"),
    `msn_id: MSN-0999
skill_key: ui
gate_command: echo OK
gate_success_substring: OK
trace_rows:
  - dod_id: "1"
    trace_quote: ${LEGISLATE_TRACE_PLACEHOLDER}
    anchor: "1"
    status: PENDING
`,
    "utf8",
  );
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      await captureConsoleAsync(async () => {
        await runVerify({ mission: ".gitagent/missions/pending.yaml" });
      });
      assert.equal(process.exitCode, 1);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});
