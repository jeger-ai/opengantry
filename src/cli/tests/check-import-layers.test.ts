import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getRepoRoot } from "../lib/git.js";

function runImportLayersCheck(repoRoot: string, ...files: string[]) {
  const script = path.join(repoRoot, "scripts", "check-import-layers.mjs");
  return spawnSync("node", [script, ...files], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

test("check-import-layers: relative path fails lib→command import", () => {
  const repoRoot = getRepoRoot();
  const violation = path.join("src", "cli", "lib", "mcp-legislation.ts");
  const result = runImportLayersCheck(repoRoot, violation);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /must not import command module/);
});

test("check-import-layers: absolute path fails lib→command import identically", () => {
  const repoRoot = getRepoRoot();
  const violation = path.join(repoRoot, "src", "cli", "lib", "mcp-legislation.ts");
  const result = runImportLayersCheck(repoRoot, violation);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /must not import command module/);
});

test("check-import-layers: clean lib file passes", () => {
  const repoRoot = getRepoRoot();
  const clean = path.join("src", "cli", "lib", "constants.ts");
  const result = runImportLayersCheck(repoRoot, clean);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /import-layers OK/);
});

test("check-import-layers: all three known lib→command violations fail", () => {
  const repoRoot = getRepoRoot();
  const violations = [
    path.join("src", "cli", "lib", "mcp-legislation.ts"),
    path.join("src", "cli", "lib", "start-orchestration.ts"),
    path.join("src", "cli", "lib", "init-tutorial.ts"),
  ];
  for (const file of violations) {
    const result = runImportLayersCheck(repoRoot, file);
    assert.notEqual(result.status, 0, `${file} should fail: ${result.stderr}`);
    assert.match(result.stderr, /must not import command module/);
  }
});
