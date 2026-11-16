import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { ENV_BYPASS_SECRET, isBypassSecretAuthorized } from "#missions/break-glass.js";
import { execFileSync } from "node:child_process";
import { gitChildEnv } from "#git/git.js";
import { gitInitCommit, writeBypassAnchor } from "./test-fixtures.js";

// MSN-0381: the anchor is read from the trusted base commit, so the fixture commits it (a working-tree anchor in a
// directory without git history no longer authorizes; see authority-break-glass.test.ts).
test("isBypassSecretAuthorized: requires env and matching anchor", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-bypass-auth-"));
  const secret = "test-break-glass-secret-value";
  writeBypassAnchor(dest, secret);
  gitInitCommit(dest, "anchor", "planner@example.com");
  // The base is the default branch; pin the fixture to main so init.defaultBranch cannot rename it.
  execFileSync("git", ["-C", dest, "branch", "-M", "main"], { env: gitChildEnv(), stdio: "pipe" });
  const prev = process.env[ENV_BYPASS_SECRET];
  delete process.env[ENV_BYPASS_SECRET];
  assert.equal(isBypassSecretAuthorized(dest), false);
  process.env[ENV_BYPASS_SECRET] = "wrong";
  assert.equal(isBypassSecretAuthorized(dest), false);
  process.env[ENV_BYPASS_SECRET] = secret;
  assert.equal(isBypassSecretAuthorized(dest), true);
  if (prev === undefined) delete process.env[ENV_BYPASS_SECRET];
  else process.env[ENV_BYPASS_SECRET] = prev;
});

