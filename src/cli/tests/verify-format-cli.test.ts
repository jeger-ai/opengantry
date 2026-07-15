/**
 * CLI-level integration tests for `gantry verify --format sarif|junit`
 * (builder unit tests live in verify-export.test.ts).
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getRepoRoot } from "../lib/git.js";
import { GXT_ERROR } from "../lib/gxt-error-codes.js";
import { runVerify } from "../commands/verify.js";
import type { VerifyExportFormat } from "../lib/verify-export.js";
import {
  writeMiniGantryRepo,
  writeMiniGantryMission,
  gitInitCommit,
} from "./test-fixtures.js";
import { captureConsoleAsync, PLANNER_EMAIL, withPlannerEnvAsync } from "./test-shared.js";

async function runVerifyFormatInRepo(
  dest: string,
  format: VerifyExportFormat,
): Promise<{ stdout: string; exitCode: number | undefined }> {
  const prevCwd = process.cwd();
  return withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      const { output } = await captureConsoleAsync(async () => {
        await runVerify({
          mission: ".gitagent/missions/m.yaml",
          executorLog: "EXECUTOR_LOG.md",
          format,
        });
      });
      const exitCode = typeof process.exitCode === "number" ? process.exitCode : undefined;
      return { stdout: output.stdout.trim(), exitCode };
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
}

test("runVerify --format sarif: pass emits valid SARIF 2.1.0 document", async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-sarif-pass-"));
  writeMiniGantryRepo(dest, getRepoRoot());
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const { stdout, exitCode } = await runVerifyFormatInRepo(dest, "sarif");
  const sarif = JSON.parse(stdout) as Record<string, unknown>;
  assert.equal(sarif.version, "2.1.0");
  const runs = sarif.runs as Record<string, unknown>[];
  assert.equal(runs.length, 1);
  const results = runs[0]?.results as Record<string, unknown>[];
  assert.equal(results.length, 0);
  assert.equal(exitCode, undefined);
});

test("runVerify --format sarif: gate failure carries GXT error code as ruleId and exits 1", async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-sarif-fail-"));
  writeMiniGantryRepo(dest, getRepoRoot());
  writeMiniGantryMission(dest, "MSN-0999", "evidence A", `bash -lc "exit 1"`, "DONE", "m.yaml");
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const { stdout, exitCode } = await runVerifyFormatInRepo(dest, "sarif");
  const sarif = JSON.parse(stdout) as Record<string, unknown>;
  const runs = sarif.runs as Record<string, unknown>[];
  const results = runs[0]?.results as Record<string, unknown>[];
  assert.equal(results[0]?.ruleId, "gate");
  assert.equal(exitCode, 1);
});

test("runVerify --format junit: pass emits testsuites with phase testcases", async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-junit-pass-"));
  writeMiniGantryRepo(dest, getRepoRoot());
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const { stdout, exitCode } = await runVerifyFormatInRepo(dest, "junit");
  assert.match(stdout, /<testsuites/);
  assert.match(stdout, /testcase classname="gantry.verify" name="git_proof"/);
  assert.doesNotMatch(stdout, /<failure/);
  assert.equal(exitCode, undefined);
});

test("runVerify --format junit: gate failure includes failure element and exits 1", async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-junit-fail-"));
  writeMiniGantryRepo(dest, getRepoRoot());
  writeMiniGantryMission(dest, "MSN-0999", "evidence A", `bash -lc "exit 1"`, "DONE", "m.yaml");
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const { stdout, exitCode } = await runVerifyFormatInRepo(dest, "junit");
  assert.match(stdout, /<failure/);
  assert.match(stdout, /name="gate"/);
  assert.equal(exitCode, 1);
});
