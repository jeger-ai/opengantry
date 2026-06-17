import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getRepoRoot } from "../lib/git.js";

function runLibCyclesCheck(repoRoot: string, ...args: string[]) {
  const script = path.join(repoRoot, "scripts", "check-lib-cycles.mjs");
  return spawnSync("node", [script, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

test("check-lib-cycles: full-tree lib scan has no runtime cycles", () => {
  const repoRoot = getRepoRoot();
  const result = runLibCyclesCheck(repoRoot);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /lib-cycles OK/);
});

test("check-lib-cycles: --json success payload", () => {
  const repoRoot = getRepoRoot();
  const result = runLibCyclesCheck(repoRoot, "--json");
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.schema_version, 1);
  assert.equal(payload.ok, true);
  assert.equal(payload.cycle, null);
});
