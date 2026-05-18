import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import { getRepoRoot } from "../lib/git.js";
import { ENV_BYPASS_SECRET, commitHasValidBypassNote } from "../lib/break-glass.js";
import { runVerify } from "../commands/verify.js";
import {
  writeMiniGapmanRepo,
  writeMiniGapmanMission,
  writeBypassAnchor,
  gitInitCommit,
} from "./test-fixtures.js";
import { TEACHER_EMAIL, withTeacherEnv } from "./test-shared.js";

test("runVerify: passes with Teacher git-proof in mini repo", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] legislate mission", TEACHER_EMAIL);
  const prevCwd = process.cwd();
  withTeacherEnv(() => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      runVerify({ mission: ".gitagent/missions/m.yaml", workerLog: "WORKER_LOG.md" });
      assert.equal(process.exitCode, undefined, "exitCode should not be set on success");
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});


test("runVerify: gate failure sets exit code 1", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-gate-"));
  writeMiniGapmanRepo(dest, ogRoot);
  writeMiniGapmanMission(dest, "MSN-0999", "evidence A", `bash -lc "exit 1"`, "DONE", "m.yaml");
  gitInitCommit(dest, "[MSN-0999] legislate mission", TEACHER_EMAIL);
  const prevCwd = process.cwd();
  withTeacherEnv(() => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      runVerify({ mission: ".gitagent/missions/m.yaml", workerLog: "WORKER_LOG.md" });
      assert.equal(process.exitCode, 1);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});


test("runVerify: trace mapping failure sets exit code 1", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-trace-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] legislate mission", TEACHER_EMAIL);
  fs.writeFileSync(path.join(dest, "WORKER_LOG.md"), "wrong evidence\n", "utf8");
  const prevCwd = process.cwd();
  withTeacherEnv(() => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      runVerify({ mission: ".gitagent/missions/m.yaml", workerLog: "WORKER_LOG.md" });
      assert.equal(process.exitCode, 1);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});


test("runVerify: break-glass without secret exits 2", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-bypass-fail-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] legislate mission", TEACHER_EMAIL);
  const prevCwd = process.cwd();
  const prevSecret = process.env[ENV_BYPASS_SECRET];
  delete process.env[ENV_BYPASS_SECRET];
  try {
    process.chdir(dest);
    process.exitCode = undefined;
    runVerify({
      mission: ".gitagent/missions/m.yaml",
      workerLog: "WORKER_LOG.md",
      breakGlass: true,
      breakGlassReason: "production outage requires hotfix",
    });
    assert.equal(process.exitCode, 2);
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
    if (prevSecret === undefined) delete process.env[ENV_BYPASS_SECRET];
    else process.env[ENV_BYPASS_SECRET] = prevSecret;
  }
});


test("runVerify: break-glass with secret skips gates", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-bypass-ok-"));
  writeMiniGapmanRepo(dest, ogRoot);
  const secret = "emergency-bypass-secret-ok";
  writeBypassAnchor(dest, secret);
  gitInitCommit(dest, "[MSN-0999] legislate mission", TEACHER_EMAIL);
  const prevCwd = process.cwd();
  const prevSecret = process.env[ENV_BYPASS_SECRET];
  process.env[ENV_BYPASS_SECRET] = secret;
  try {
    process.chdir(dest);
    process.exitCode = undefined;
    runVerify({
      mission: ".gitagent/missions/m.yaml",
      workerLog: "WORKER_LOG.md",
      breakGlass: true,
      breakGlassReason: "production outage requires hotfix",
    });
    assert.equal(process.exitCode, undefined);
    const head = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();
    assert.equal(commitHasValidBypassNote(dest, head), true);
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
    if (prevSecret === undefined) delete process.env[ENV_BYPASS_SECRET];
    else process.env[ENV_BYPASS_SECRET] = prevSecret;
  }
});

