import test from "node:test";
import assert from "node:assert/strict";
import {
  ENV_TEACHER_EMAILS,
  GIT_CONFIG_TEACHER_EMAILS,
  readEnvWithLegacy,
  readGitConfigWithLegacy,
} from "../lib/config-namespace.js";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("readEnvWithLegacy: GANTRY_* wins over GAPMAN_*", () => {
  const env = {
    GANTRY_TEACHER_EMAILS: "new@example.com",
    GAPMAN_TEACHER_EMAILS: "legacy@example.com",
  };
  assert.equal(readEnvWithLegacy("TEACHER_EMAILS", env), "new@example.com");
});

test("readEnvWithLegacy: silent GAPMAN_* fallback", () => {
  const env = { GAPMAN_TEACHER_EMAILS: "legacy@example.com" };
  assert.equal(readEnvWithLegacy("TEACHER_EMAILS", env), "legacy@example.com");
});

test("readEnvWithLegacy: canonical env names exported", () => {
  assert.equal(ENV_TEACHER_EMAILS, "GANTRY_TEACHER_EMAILS");
  assert.equal(GIT_CONFIG_TEACHER_EMAILS, "gantry.teacherEmails");
});

test("readGitConfigWithLegacy: gantry.* wins over gapman.*", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ns-"));
  execSync("git init", { cwd: dest, stdio: "pipe" });
  execSync('git config gapman.teacherEmails "legacy@example.com"', { cwd: dest, stdio: "pipe" });
  execSync('git config gantry.teacherEmails "new@example.com"', { cwd: dest, stdio: "pipe" });
  assert.equal(readGitConfigWithLegacy(dest, "teacherEmails"), "new@example.com");
});

test("readGitConfigWithLegacy: silent gapman.* fallback", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ns-"));
  execSync("git init", { cwd: dest, stdio: "pipe" });
  execSync('git config gapman.teacherEmails "legacy@example.com"', { cwd: dest, stdio: "pipe" });
  assert.equal(readGitConfigWithLegacy(dest, "teacherEmails"), "legacy@example.com");
});
