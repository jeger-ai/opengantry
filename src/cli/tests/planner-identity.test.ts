import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import {
  ENV_PLANNER_EMAILS,
  REL_PLANNER_ALLOWLIST,
  REL_PLANNER_ALLOWLIST_LOCAL,
  ensurePlannerAllowlistOnInit,
  resolvePlannerEmails,
  writePlannerAllowlistLocal,
} from "../lib/planner-identity.js";

function mkRepo(): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-teacher-id-"));
  execSync("git init", { cwd: dest, stdio: "pipe" });
  execSync('git config user.email "repo-teacher@example.com"', { cwd: dest, stdio: "pipe" });
  execSync('git config user.name "Fixture"', { cwd: dest, stdio: "pipe" });
  return dest;
}

test("resolvePlannerEmails: repo allowlist.local beats env", () => {
  const dest = mkRepo();
  writePlannerAllowlistLocal(dest, ["local@example.com"]);
  const prev = process.env[ENV_PLANNER_EMAILS];
  process.env[ENV_PLANNER_EMAILS] = "env@example.com";
  try {
    const r = resolvePlannerEmails(dest);
    assert.deepEqual(r.emails, ["local@example.com"]);
    assert.equal(r.source, "allowlist_local");
  } finally {
    if (prev === undefined) delete process.env[ENV_PLANNER_EMAILS];
    else process.env[ENV_PLANNER_EMAILS] = prev;
  }
});

test("resolvePlannerEmails: git config gantry.plannerEmails", () => {
  const dest = mkRepo();
  execSync('git config gantry.plannerEmails "gitcfg@example.com"', { cwd: dest, stdio: "pipe" });
  const r = resolvePlannerEmails(dest);
  assert.deepEqual(r.emails, ["gitcfg@example.com"]);
  assert.equal(r.source, "git_config");
});

test("resolvePlannerEmails: legacy git config gapman.plannerEmails fallback", () => {
  const dest = mkRepo();
  execSync('git config gapman.plannerEmails "legacy@example.com"', { cwd: dest, stdio: "pipe" });
  const r = resolvePlannerEmails(dest);
  assert.deepEqual(r.emails, ["legacy@example.com"]);
  assert.equal(r.source, "git_config");
});

test("resolvePlannerEmails: env fallback when no repo config", () => {
  const dest = mkRepo();
  const prev = process.env[ENV_PLANNER_EMAILS];
  process.env[ENV_PLANNER_EMAILS] = "ci@example.com";
  try {
    const r = resolvePlannerEmails(dest);
    assert.deepEqual(r.emails, ["ci@example.com"]);
    assert.equal(r.source, "env");
  } finally {
    if (prev === undefined) delete process.env[ENV_PLANNER_EMAILS];
    else process.env[ENV_PLANNER_EMAILS] = prev;
  }
});

test("resolvePlannerEmails: implicit git user.email when unset", () => {
  const dest = mkRepo();
  const prev = process.env[ENV_PLANNER_EMAILS];
  delete process.env[ENV_PLANNER_EMAILS];
  try {
    const r = resolvePlannerEmails(dest);
    assert.deepEqual(r.emails, ["repo-teacher@example.com"]);
    assert.equal(r.source, "git_user_email");
  } finally {
    if (prev === undefined) delete process.env[ENV_PLANNER_EMAILS];
    else process.env[ENV_PLANNER_EMAILS] = prev;
  }
});

test("ensurePlannerAllowlistOnInit: writes local allowlist from git email", () => {
  const dest = mkRepo();
  assert.equal(ensurePlannerAllowlistOnInit(dest), true);
  const abs = path.join(dest, REL_PLANNER_ALLOWLIST_LOCAL.split("/").join(path.sep));
  assert.ok(fs.existsSync(abs));
  assert.match(fs.readFileSync(abs, "utf8"), /repo-teacher@example.com/);
});

test("resolvePlannerEmails: merges team allowlist and local", () => {
  const dest = mkRepo();
  const teamAbs = path.join(dest, REL_PLANNER_ALLOWLIST.split("/").join(path.sep));
  fs.mkdirSync(path.dirname(teamAbs), { recursive: true });
  fs.writeFileSync(teamAbs, "team@example.com\n", "utf8");
  writePlannerAllowlistLocal(dest, ["local@example.com"]);
  const r = resolvePlannerEmails(dest);
  assert.deepEqual(r.emails.sort(), ["local@example.com", "team@example.com"].sort());
});
