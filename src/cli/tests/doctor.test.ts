import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { runDoctor } from "../commands/doctor.js";
import { getRepoRoot } from "../lib/git.js";
import { ENV_BYPASS_SECRET } from "../lib/break-glass.js";
import {
  writeManifest,
  writeSkillsForManifest,
  writeMiniGapmanRepo,
  writeBypassAnchor,
  gitInitCommit,
} from "./test-fixtures.js";
import { TEACHER_EMAIL } from "./test-shared.js";

test("runDoctor: warn on missing teacher email exits 0", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-doctor-warn-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] init", TEACHER_EMAIL);
  const prevCwd = process.cwd();
  const prevTeachers = process.env.GAPMAN_TEACHER_EMAILS;
  delete process.env.GAPMAN_TEACHER_EMAILS;
  try {
    process.chdir(dest);
    process.exitCode = undefined;
    runDoctor();
    assert.equal(process.exitCode, undefined);
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
    if (prevTeachers === undefined) delete process.env.GAPMAN_TEACHER_EMAILS;
    else process.env.GAPMAN_TEACHER_EMAILS = prevTeachers;
  }
});


test("runDoctor: active bypass secret match", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-doctor-bypass-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] init", TEACHER_EMAIL);
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

