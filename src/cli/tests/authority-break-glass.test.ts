/**
 * MSN-0381 (issue #356, ADR-0063 Q10): the break-glass anchor is read from the trusted base commit. The old attack wrote
 * `.gitagent/foreman/BYPASS.sha256` next to a secret it chose; neither a working-tree edit nor a commit on the branch
 * under review moves the anchor now, and no base or no anchor at the base refuses.
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gitChildEnv } from "#git/git.js";
import { ENV_BYPASS_SECRET, bypassAuthorization, isBypassSecretAuthorized } from "#missions/break-glass.js";

const ANCHOR = path.join(".gitagent", "foreman", "BYPASS.sha256");
const TEAM = "team-secret-held-by-the-planner";
const MINE = "secret-the-candidate-chose";

function git(dest: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", dest, ...args], { encoding: "utf8", env: gitChildEnv() });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function writeAnchor(dest: string, secret: string): void {
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.writeFileSync(path.join(dest, ANCHOR), `${crypto.createHash("sha256").update(secret, "utf8").digest("hex")}\n`);
}

/** A repository whose main branch committed the team anchor. */
function repo(prefix: string): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(dest, "init", "-q", "-b", "main");
  git(dest, "config", "user.email", "t@example.com");
  git(dest, "config", "user.name", "T");
  writeAnchor(dest, TEAM);
  git(dest, "add", "-A");
  git(dest, "commit", "-qm", "anchor");
  return dest;
}

function withSecret<T>(secret: string | undefined, fn: () => T): T {
  const prev = process.env[ENV_BYPASS_SECRET];
  if (secret === undefined) delete process.env[ENV_BYPASS_SECRET];
  else process.env[ENV_BYPASS_SECRET] = secret;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[ENV_BYPASS_SECRET];
    else process.env[ENV_BYPASS_SECRET] = prev;
  }
}

const verdictCode = (dest: string, secret: string | undefined): string => {
  const v = withSecret(secret, () => bypassAuthorization(dest));
  return v.ok ? "ok" : v.code;
};

test("break-glass: a working-tree anchor edit does not grant bypass (the old attack)", () => {
  const dest = repo("og-auth-bg-wt-");
  writeAnchor(dest, MINE);
  assert.equal(withSecret(MINE, () => isBypassSecretAuthorized(dest)), false);
  assert.equal(verdictCode(dest, MINE), "BYPASS_SECRET_INVALID");
  assert.equal(withSecret(TEAM, () => isBypassSecretAuthorized(dest)), true, "the committed anchor still authorizes the team secret");
});

test("break-glass: an anchor committed on the branch under review does not grant bypass", () => {
  const dest = repo("og-auth-bg-branch-");
  git(dest, "checkout", "-qb", "feature");
  writeAnchor(dest, MINE);
  git(dest, "commit", "-qam", "rewrite anchor");
  assert.equal(verdictCode(dest, MINE), "BYPASS_SECRET_INVALID");
  assert.equal(verdictCode(dest, TEAM), "ok");
});

test("break-glass: with a remote, a local commit on main does not move the anchor", () => {
  const origin = repo("og-auth-bg-origin-");
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-auth-bg-clone-"));
  git(path.dirname(dest), "clone", "-q", origin, dest);
  git(dest, "config", "user.email", "t@example.com");
  git(dest, "config", "user.name", "T");
  writeAnchor(dest, MINE);
  git(dest, "commit", "-qam", "rewrite anchor on local main");
  assert.equal(verdictCode(dest, MINE), "BYPASS_SECRET_INVALID");
  assert.equal(verdictCode(dest, TEAM), "ok");
});

test("break-glass: no base commit or no anchor at the base fails closed", () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "og-auth-bg-nogit-"));
  writeAnchor(plain, MINE);
  assert.equal(verdictCode(plain, MINE), "BYPASS_BASE_UNKNOWN", "not a repository");

  const orphan = repo("og-auth-bg-orphan-");
  git(orphan, "checkout", "-q", "--orphan", "elsewhere");
  git(orphan, "commit", "-qm", "unrelated history");
  git(orphan, "branch", "-D", "main");
  assert.equal(verdictCode(orphan, TEAM), "BYPASS_BASE_UNKNOWN", "no default branch");

  const unanchored = fs.mkdtempSync(path.join(os.tmpdir(), "og-auth-bg-none-"));
  git(unanchored, "init", "-q", "-b", "main");
  git(unanchored, "config", "user.email", "t@example.com");
  git(unanchored, "config", "user.name", "T");
  fs.writeFileSync(path.join(unanchored, "README.md"), "x\n");
  git(unanchored, "add", "-A");
  git(unanchored, "commit", "-qm", "init");
  writeAnchor(unanchored, MINE);
  assert.equal(verdictCode(unanchored, MINE), "BYPASS_NOT_CONFIGURED", "an uncommitted anchor is not an anchor");
  assert.equal(verdictCode(repo("og-auth-bg-nosecret-"), undefined), "BYPASS_SECRET_MISSING");
});

/** A clone whose origin/HEAD names main (team anchor), with a branch `master` the candidate pushed to origin. */
function cloneWithPushedMaster(): string {
  const origin = repo("og-auth-bg-two-origin-");
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-auth-bg-two-"));
  git(path.dirname(dest), "clone", "-q", origin, dest);
  git(dest, "config", "user.email", "t@example.com");
  git(dest, "config", "user.name", "T");
  writeAnchor(dest, MINE);
  git(dest, "commit", "-qam", "candidate anchor");
  git(dest, "push", "-q", "origin", "HEAD:refs/heads/master");
  git(dest, "fetch", "-q", "origin");
  return dest;
}

test("break-glass: origin/HEAD decides; a pushed origin/master closer to HEAD does not win", () => {
  const dest = cloneWithPushedMaster();
  assert.equal(git(dest, "symbolic-ref", "refs/remotes/origin/HEAD"), "refs/remotes/origin/main");
  assert.equal(verdictCode(dest, MINE), "BYPASS_SECRET_INVALID", "the candidate's anchor on origin/master is ignored");
  assert.equal(verdictCode(dest, TEAM), "ok");
  // Without origin/HEAD, two remote default names are ambiguous: refuse rather than guess.
  git(dest, "remote", "set-head", "origin", "--delete");
  assert.equal(verdictCode(dest, MINE), "BYPASS_BASE_UNKNOWN");
  assert.equal(verdictCode(dest, TEAM), "BYPASS_BASE_UNKNOWN");
});

test("break-glass: a remote default without shared history refuses; local main is never the fallback", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-auth-bg-unrelated-"));
  git(dest, "init", "-q", "-b", "main");
  git(dest, "config", "user.email", "t@example.com");
  git(dest, "config", "user.name", "T");
  writeAnchor(dest, MINE);
  git(dest, "add", "-A");
  git(dest, "commit", "-qm", "candidate anchor on local main, equal to HEAD");
  const unrelated = repo("og-auth-bg-unrelated-origin-");
  git(dest, "remote", "add", "origin", unrelated);
  git(dest, "fetch", "-q", "origin");
  assert.equal(verdictCode(dest, MINE), "BYPASS_BASE_UNKNOWN", "origin/main exists without a merge-base");
  git(dest, "remote", "set-head", "origin", "main");
  assert.equal(verdictCode(dest, MINE), "BYPASS_BASE_UNKNOWN", "origin/HEAD exists without a merge-base");
});
