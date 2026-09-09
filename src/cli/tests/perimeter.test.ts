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
} from "../lib/perimeter.js";
import { REL_PLANNER_SIGNING_PUB } from "../lib/constants.js";
import { ensurePlannerAllowedSignersFile } from "../lib/planner-signature.js";
import { pathMatchesPerimeterGlob } from "../lib/path-glob.js";
import type { Manifest } from "../lib/types.js";
import { gitCommit, gitInitCommit } from "./test-fixtures.js";

const manifest: Manifest = {
  schema_version: "0.5.0",
  skills: {},
  path_risks: {},
  risk_keywords: [],
  perimeter_protected: [...DEFAULT_PERIMETER_PROTECTED],
};

test("pathMatchesPerimeterGlob: ** suffix glob", () => {
  assert.equal(pathMatchesPerimeterGlob("src/db/.gxt-skill.yaml", "**/.gxt-skill.yaml"), true);
  assert.equal(pathMatchesPerimeterGlob("README.md", "**/.gxt-skill.yaml"), false);
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
