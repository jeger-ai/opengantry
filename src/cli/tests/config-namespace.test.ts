import test from "node:test";
import assert from "node:assert/strict";
import { ENV_PLANNER_EMAILS, GIT_CONFIG_PLANNER_EMAILS, readGantryEnv, readGantryGitConfig } from "../lib/config-namespace.js";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("readGantryEnv: GANTRY_* only; blank is unset; no legacy prefix is read", () => {
  assert.equal(readGantryEnv("PLANNER_EMAILS", { GANTRY_PLANNER_EMAILS: "new@example.com" }), "new@example.com");
  assert.equal(readGantryEnv("PLANNER_EMAILS", { GANTRY_PLANNER_EMAILS: "  " }), undefined);
  assert.equal(readGantryEnv("PLANNER_EMAILS", { OTHER_PLANNER_EMAILS: "legacy@example.com" }), undefined);
});

test("canonical names exported", () => {
  assert.equal(ENV_PLANNER_EMAILS, "GANTRY_PLANNER_EMAILS");
  assert.equal(GIT_CONFIG_PLANNER_EMAILS, "gantry.plannerEmails");
});

test("readGantryGitConfig: gantry.* only; no legacy key is read", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ns-"));
  execSync("git init", { cwd: dest, stdio: "pipe" });
  execSync('git config other.plannerEmails "legacy@example.com"', { cwd: dest, stdio: "pipe" });
  assert.equal(readGantryGitConfig(dest, "plannerEmails"), null);
  execSync('git config gantry.plannerEmails "new@example.com"', { cwd: dest, stdio: "pipe" });
  assert.equal(readGantryGitConfig(dest, "plannerEmails"), "new@example.com");
});
