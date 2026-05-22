import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import {
  ENV_TEACHER_EMAILS,
  REL_TEACHER_ALLOWLIST,
  REL_TEACHER_ALLOWLIST_LOCAL,
  ensureTeacherAllowlistOnInit,
  resolveTeacherEmails,
  writeTeacherAllowlistLocal,
} from "../lib/teacher-identity.js";

function mkRepo(): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-teacher-id-"));
  execSync("git init", { cwd: dest, stdio: "pipe" });
  execSync('git config user.email "repo-teacher@example.com"', { cwd: dest, stdio: "pipe" });
  execSync('git config user.name "Fixture"', { cwd: dest, stdio: "pipe" });
  return dest;
}

test("resolveTeacherEmails: repo allowlist.local beats env", () => {
  const dest = mkRepo();
  writeTeacherAllowlistLocal(dest, ["local@example.com"]);
  const prev = process.env[ENV_TEACHER_EMAILS];
  process.env[ENV_TEACHER_EMAILS] = "env@example.com";
  try {
    const r = resolveTeacherEmails(dest);
    assert.deepEqual(r.emails, ["local@example.com"]);
    assert.equal(r.source, "allowlist_local");
  } finally {
    if (prev === undefined) delete process.env[ENV_TEACHER_EMAILS];
    else process.env[ENV_TEACHER_EMAILS] = prev;
  }
});

test("resolveTeacherEmails: git config gapman.teacherEmails", () => {
  const dest = mkRepo();
  execSync('git config gapman.teacherEmails "gitcfg@example.com"', { cwd: dest, stdio: "pipe" });
  const r = resolveTeacherEmails(dest);
  assert.deepEqual(r.emails, ["gitcfg@example.com"]);
  assert.equal(r.source, "git_config");
});

test("resolveTeacherEmails: env fallback when no repo config", () => {
  const dest = mkRepo();
  const prev = process.env[ENV_TEACHER_EMAILS];
  process.env[ENV_TEACHER_EMAILS] = "ci@example.com";
  try {
    const r = resolveTeacherEmails(dest);
    assert.deepEqual(r.emails, ["ci@example.com"]);
    assert.equal(r.source, "env");
  } finally {
    if (prev === undefined) delete process.env[ENV_TEACHER_EMAILS];
    else process.env[ENV_TEACHER_EMAILS] = prev;
  }
});

test("resolveTeacherEmails: implicit git user.email when unset", () => {
  const dest = mkRepo();
  const prev = process.env[ENV_TEACHER_EMAILS];
  delete process.env[ENV_TEACHER_EMAILS];
  try {
    const r = resolveTeacherEmails(dest);
    assert.deepEqual(r.emails, ["repo-teacher@example.com"]);
    assert.equal(r.source, "git_user_email");
  } finally {
    if (prev === undefined) delete process.env[ENV_TEACHER_EMAILS];
    else process.env[ENV_TEACHER_EMAILS] = prev;
  }
});

test("ensureTeacherAllowlistOnInit: writes local allowlist from git email", () => {
  const dest = mkRepo();
  assert.equal(ensureTeacherAllowlistOnInit(dest), true);
  const abs = path.join(dest, REL_TEACHER_ALLOWLIST_LOCAL.split("/").join(path.sep));
  assert.ok(fs.existsSync(abs));
  assert.match(fs.readFileSync(abs, "utf8"), /repo-teacher@example.com/);
});

test("resolveTeacherEmails: merges team allowlist and local", () => {
  const dest = mkRepo();
  const teamAbs = path.join(dest, REL_TEACHER_ALLOWLIST.split("/").join(path.sep));
  fs.mkdirSync(path.dirname(teamAbs), { recursive: true });
  fs.writeFileSync(teamAbs, "team@example.com\n", "utf8");
  writeTeacherAllowlistLocal(dest, ["local@example.com"]);
  const r = resolveTeacherEmails(dest);
  assert.deepEqual(r.emails.sort(), ["local@example.com", "team@example.com"].sort());
});
