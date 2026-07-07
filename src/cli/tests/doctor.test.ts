import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { runDoctor } from "../commands/doctor.js";
import { getRepoRoot } from "../lib/git.js";
import { ENV_BYPASS_SECRET } from "../lib/break-glass.js";
import { writeMiniGapmanRepo, writeBypassAnchor, gitInitCommit } from "./test-fixtures.js";
import { PLANNER_EMAIL } from "./test-shared.js";

test("runDoctor: implicit git user.email satisfies planner check", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-doctor-warn-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] init", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  const prevTeachers = process.env.GAPMAN_PLANNER_EMAILS;
  delete process.env.GAPMAN_PLANNER_EMAILS;
  try {
    process.chdir(dest);
    process.exitCode = undefined;
    runDoctor();
    assert.equal(process.exitCode, undefined);
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
    if (prevTeachers === undefined) delete process.env.GAPMAN_PLANNER_EMAILS;
    else process.env.GAPMAN_PLANNER_EMAILS = prevTeachers;
  }
});

test("runDoctor: invalid architecture pointer exits 1", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-doctor-arch-fail-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] init", PLANNER_EMAIL);
  fs.mkdirSync(path.join(dest, ".gitagent"), { recursive: true });
  fs.writeFileSync(path.join(dest, ".gitagent", "ARCHITECTURE.pointer.json"), "{ not json", "utf8");
  const prevCwd = process.cwd();
  const prevTeachers = process.env.GAPMAN_PLANNER_EMAILS;
  process.env.GAPMAN_PLANNER_EMAILS = PLANNER_EMAIL;
  try {
    process.chdir(dest);
    process.exitCode = undefined;
    runDoctor();
    assert.equal(process.exitCode, 1);
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
    if (prevTeachers === undefined) delete process.env.GAPMAN_PLANNER_EMAILS;
    else process.env.GAPMAN_PLANNER_EMAILS = prevTeachers;
  }
});

test("runDoctor: active bypass secret match", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-doctor-bypass-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] init", PLANNER_EMAIL);
  const secret = "doctor-bypass-secret";
  writeBypassAnchor(dest, secret);
  const prevCwd = process.cwd();
  const prev = process.env[ENV_BYPASS_SECRET];
  process.env[ENV_BYPASS_SECRET] = secret;
  try {
    process.chdir(dest);
    process.exitCode = undefined;
    runDoctor();
    assert.equal(process.exitCode, undefined);
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
    if (prev === undefined) delete process.env[ENV_BYPASS_SECRET];
    else process.env[ENV_BYPASS_SECRET] = prev;
  }
});
