import test from "node:test";
import assert from "node:assert/strict";
import {
  ENV_PLANNER_EMAILS,
  GIT_CONFIG_PLANNER_EMAILS,
  readEnvWithLegacy,
  readGitConfigWithLegacy,
} from "../lib/config-namespace.js";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("readEnvWithLegacy: GANTRY_* wins over GAPMAN_*", () => {
  const env = {
    GANTRY_PLANNER_EMAILS: "new@example.com",
    GAPMAN_PLANNER_EMAILS: "legacy@example.com",
  };
  assert.equal(readEnvWithLegacy("PLANNER_EMAILS", env), "new@example.com");
});

test("readEnvWithLegacy: silent GAPMAN_* fallback", () => {
  const env = { GAPMAN_PLANNER_EMAILS: "legacy@example.com" };
  assert.equal(readEnvWithLegacy("PLANNER_EMAILS", env), "legacy@example.com");
});

test("readEnvWithLegacy: canonical env names exported", () => {
  assert.equal(ENV_PLANNER_EMAILS, "GANTRY_PLANNER_EMAILS");
  assert.equal(GIT_CONFIG_PLANNER_EMAILS, "gantry.plannerEmails");
});

test("readGitConfigWithLegacy: gantry.* wins over gapman.*", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ns-"));
  execSync("git init", { cwd: dest, stdio: "pipe" });
  execSync('git config gapman.plannerEmails "legacy@example.com"', { cwd: dest, stdio: "pipe" });
  execSync('git config gantry.plannerEmails "new@example.com"', { cwd: dest, stdio: "pipe" });
  assert.equal(readGitConfigWithLegacy(dest, "plannerEmails"), "new@example.com");
});

test("readGitConfigWithLegacy: silent gapman.* fallback", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ns-"));
  execSync("git init", { cwd: dest, stdio: "pipe" });
  execSync('git config gapman.plannerEmails "legacy@example.com"', { cwd: dest, stdio: "pipe" });
  assert.equal(readGitConfigWithLegacy(dest, "plannerEmails"), "legacy@example.com");
});
