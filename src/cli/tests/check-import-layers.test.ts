import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { getRepoRoot } from "../lib/git.js";

const FIXTURE_VIOLATION = path.join(
  "src",
  "cli",
  "tests",
  "fixtures",
  "import-layer-violation.ts",
);

function runImportLayersCheck(repoRoot: string, ...files: string[]) {
  const script = path.join(repoRoot, "scripts", "check-import-layers.mjs");
  return spawnSync("node", [script, ...files], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

test("check-import-layers: relative path fails lib→command import", () => {
  const repoRoot = getRepoRoot();
  const result = runImportLayersCheck(repoRoot, FIXTURE_VIOLATION);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /must not import command module/);
});

test("check-import-layers: absolute path fails lib→command import identically", () => {
  const repoRoot = getRepoRoot();
  const violation = path.join(repoRoot, FIXTURE_VIOLATION);
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

test("check-import-layers: full-tree lib scan has zero command imports (#43)", () => {
  const repoRoot = getRepoRoot();
  const files = execSync("git ls-files 'src/cli/lib/**/*.ts'", {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  const result = runImportLayersCheck(repoRoot, ...files);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /import-layers OK/);
});
