import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { getRepoRoot } from "../lib/git.js";

const CLI = path.join(getRepoRoot(), "dist/cli/index.js");

test("CLI --audience verifier: silent stdout on successful check", () => {
  const r = spawnSync("node", [CLI, "--audience", "verifier", "check"], {
    encoding: "utf8",
    cwd: getRepoRoot(),
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "");
});

test("CLI --audience verifier: invalid role exits 2", () => {
  const r = spawnSync("node", [CLI, "--audience", "bot", "check"], {
    encoding: "utf8",
    cwd: getRepoRoot(),
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /invalid --audience/);
});
