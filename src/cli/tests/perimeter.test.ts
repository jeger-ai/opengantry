import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import {
  checkPerimeter,
  listCommitsTouchingPathInRange,
  DEFAULT_PERIMETER_PROTECTED,
  isPerimeterProtectedPath,
} from "#missions/perimeter.js";
import { ensurePlannerAllowedSignersFile } from "#missions/planner-signature.js";
import { patternCoversPath } from "#core/path-glob.js";
import type { Manifest } from "#core/manifest.js";
import { gitCommit, gitInitCommit } from "./test-fixtures.js";
import { writeOrgPolicyRepo } from "./test-org-fixtures.js";
import { getRepoRoot } from "#git/git.js";
import { REL_PLANNER_SIGNING_PUB, REL_POLICY_POINTER_JSON } from "#core/constants.js";

const manifest: Manifest = {
  schema_version: "0.5.0",
  skills: {},
  path_risks: {},
  risk_keywords: [],
  perimeter_protected: [...DEFAULT_PERIMETER_PROTECTED],
};

test("perimeter patterns: ** globs, exact files, and a folder entry protects everything below it", () => {
  assert.equal(patternCoversPath("**/.gxt-skill.yaml", "src/db/.gxt-skill.yaml"), true);
  assert.equal(patternCoversPath("**/.gxt-skill.yaml", "README.md"), false);
  assert.equal(isPerimeterProtectedPath(".gitagent/registry/env.yaml", [".gitagent/registry/"]), true);
  assert.equal(isPerimeterProtectedPath(".gitagent/registry.md", [".gitagent/registry/"]), false);
});

test("checkPerimeter: local mode is advisory-only (no hard fail on unsigned)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-perim-"));
  fs.mkdirSync(path.join(root, ".gitagent", "foreman"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".gitagent", "foreman", "MANIFEST.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  gitInitCommit(root, "init", "teacher@test.local");
  fs.writeFileSync(
    path.join(root, ".gitagent", "foreman", "MANIFEST.json"),
    `${JSON.stringify({ ...manifest, schema_version: "0.5.1" }, null, 2)}\n`,
    "utf8",
  );
  gitCommit(root, "agent tweak manifest", "agent@test.local");
  const result = checkPerimeter(root, manifest, { baseRef: "HEAD~1", ci: false });
  assert.equal(result.ok, true);
  assert.ok(result.advisories.length > 0 || result.violations.every((v) => v.advisoryOnly));
});

test("checkPerimeter: CI mode fails on unsigned protected commit", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-perim-ci-"));
  fs.mkdirSync(path.join(root, ".gitagent", "foreman"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".gitagent", "foreman", "MANIFEST.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  execSync("git init", { cwd: root, stdio: "pipe" });
  execSync('git config user.email "teacher@test.local"', { cwd: root, stdio: "pipe" });
  execSync('git config user.name "Teacher"', { cwd: root, stdio: "pipe" });
  execSync("git add -A", { cwd: root, stdio: "pipe" });
  execSync('git commit -m "init"', { cwd: root, stdio: "pipe" });
  fs.writeFileSync(
    path.join(root, ".gitagent", "foreman", "MANIFEST.json"),
    `${JSON.stringify({ ...manifest, schema_version: "0.5.1" }, null, 2)}\n`,
    "utf8",
  );
  execSync("git add -A", { cwd: root, stdio: "pipe" });
  execSync('git commit -m "[MSN-0001] tweak" --author="Planner <teacher@test.local>"', {
    cwd: root,
    stdio: "pipe",
  });
  const result = checkPerimeter(root, manifest, { baseRef: "HEAD~1", ci: true });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => !v.advisoryOnly));
  assert.ok(result.violations.some((v) => /GXT_PERIMETER_VIOLATION/.test(v.reason)));
});

test("checkPerimeter: CI mode fails when unsigned commit precedes later touch on same path", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-perim-launder-"));
  fs.mkdirSync(path.join(root, ".gitagent", "foreman"), { recursive: true });
  const manifestPath = path.join(root, ".gitagent", "foreman", "MANIFEST.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  execSync("git init", { cwd: root, stdio: "pipe" });
  execSync('git config user.email "teacher@test.local"', { cwd: root, stdio: "pipe" });
  execSync('git config user.name "Teacher"', { cwd: root, stdio: "pipe" });
  execSync("git add -A", { cwd: root, stdio: "pipe" });
  execSync('git commit -m "init"', { cwd: root, stdio: "pipe" });
  fs.writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, schema_version: "0.5.1" }, null, 2)}\n`, "utf8");
  execSync("git add -A", { cwd: root, stdio: "pipe" });
  execSync('git commit -m "[MSN-0001] unsigned tweak" --author="Agent <agent@test.local>"', {
    cwd: root,
    stdio: "pipe",
  });
  fs.writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, schema_version: "0.5.2" }, null, 2)}\n`, "utf8");
  execSync("git add -A", { cwd: root, stdio: "pipe" });
  execSync('git commit -m "[MSN-0001] signed follow-up" --author="Planner <teacher@test.local>"', {
    cwd: root,
    stdio: "pipe",
  });
  const result = checkPerimeter(root, manifest, { baseRef: "HEAD~2", ci: true });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => /GXT_PERIMETER_VIOLATION/.test(v.reason)));
});

test("checkPerimeter: CI mode fails closed on missing base ref", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-perim-shallow-"));
  fs.mkdirSync(path.join(root, ".gitagent", "foreman"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".gitagent", "foreman", "MANIFEST.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  execSync("git init", { cwd: root, stdio: "pipe" });
  execSync('git config user.email "teacher@test.local"', { cwd: root, stdio: "pipe" });
  execSync('git config user.name "Teacher"', { cwd: root, stdio: "pipe" });
  execSync("git add -A", { cwd: root, stdio: "pipe" });
  execSync('git commit -m "init"', { cwd: root, stdio: "pipe" });
  const result = checkPerimeter(root, manifest, { baseRef: "deadbeef00000000000000000000000000000000", ci: true });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => /GXT_PERIMETER_SHALLOW_HISTORY/.test(v.reason)));
});

/** A repository whose org floor adds `docs/policy/` to the perimeter, with an unsigned change to docs/policy/x.md. */
function orgPerimeterRepo(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  writeOrgPolicyRepo(root, getRepoRoot(), "manifest_constraints:\n  perimeter_protected_add:\n    - docs/policy/\n");
  fs.mkdirSync(path.join(root, "docs", "policy"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "policy", "x.md"), "a\n", "utf8");
  gitInitCommit(root, "init", "teacher@test.local");
  fs.writeFileSync(path.join(root, "docs", "policy", "x.md"), "b\n", "utf8");
  gitCommit(root, "agent edit", "agent@test.local");
  return root;
}

test("checkPerimeter: the org floor's perimeter_protected_add protects its paths (ADR-0042, ADR-0054 decision 10)", () => {
  const root = orgPerimeterRepo("og-perim-org-");
  const result = checkPerimeter(root, manifest, { baseRef: "HEAD~1", ci: true });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.path === "docs/policy/x.md" && /GXT_PERIMETER_VIOLATION/.test(v.reason)));
});

test("checkPerimeter: CI mode fails closed when the org floor cannot be read", () => {
  const root = orgPerimeterRepo("og-perim-org-bad-");
  const pointer = path.join(root, REL_POLICY_POINTER_JSON);
  const doc = JSON.parse(fs.readFileSync(pointer, "utf8")) as { bundle_sha256: string };
  fs.writeFileSync(pointer, JSON.stringify({ ...doc, bundle_sha256: "0".repeat(64) }), "utf8");
  const ci = checkPerimeter(root, manifest, { baseRef: "HEAD~1", ci: true });
  assert.equal(ci.ok, false);
  assert.ok(ci.violations.some((v) => v.path === "(org policy)" && /org policy floor unreadable/.test(v.reason)));
  const local = checkPerimeter(root, manifest, { baseRef: "HEAD~1", ci: false });
  assert.equal(local.ok, true);
  assert.ok(local.advisories.some((a) => /org policy floor unreadable/.test(a)));
});

test("listCommitsTouchingPathInRange: returns all commits not just last", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-perim-range-"));
  fs.mkdirSync(path.join(root, ".gitagent", "foreman"), { recursive: true });
  const manifestPath = path.join(root, ".gitagent", "foreman", "MANIFEST.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  execSync("git init", { cwd: root, stdio: "pipe" });
  execSync('git config user.email "teacher@test.local"', { cwd: root, stdio: "pipe" });
  execSync('git config user.name "Teacher"', { cwd: root, stdio: "pipe" });
  execSync("git add -A", { cwd: root, stdio: "pipe" });
  execSync('git commit -m "init"', { cwd: root, stdio: "pipe" });
  fs.writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, schema_version: "0.5.1" }, null, 2)}\n`, "utf8");
  execSync("git add -A", { cwd: root, stdio: "pipe" });
  execSync('git commit -m "touch1"', { cwd: root, stdio: "pipe" });
  fs.writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, schema_version: "0.5.2" }, null, 2)}\n`, "utf8");
  execSync("git add -A", { cwd: root, stdio: "pipe" });
  execSync('git commit -m "touch2"', { cwd: root, stdio: "pipe" });
  const rel = ".gitagent/foreman/MANIFEST.json";
  const range = listCommitsTouchingPathInRange(root, "HEAD~2", rel);
  assert.equal(range.ok, true);
  if (range.ok) {
    assert.equal(range.commits.length, 2);
  }
});

test("ensurePlannerAllowedSignersFile: sets gpg.ssh.allowedSignersFile when pub file exists", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-perim-signers-"));
  fs.mkdirSync(path.join(root, ".gitagent", "foreman"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".gitagent", "foreman", "MANIFEST.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, ".gitagent", "foreman", "PLANNER.signing.pub"),
    "# test allowed signers\n",
    "utf8",
  );
  gitInitCommit(root, "init", "teacher@test.local");
  const result = ensurePlannerAllowedSignersFile(root);
  assert.equal(result.present, true);
  assert.equal(result.configured, true);
  assert.equal(result.path, REL_PLANNER_SIGNING_PUB);
  const configured = execSync("git config --get gpg.ssh.allowedSignersFile", {
    cwd: root,
    encoding: "utf8",
  }).trim();
  assert.equal(configured, REL_PLANNER_SIGNING_PUB);
});
