import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import {
  checkPerimeter,
  pathMatchesPerimeterGlob,
  DEFAULT_PERIMETER_PROTECTED,
} from "../lib/perimeter.js";
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
  execSync('git commit -m "[MSN-0001] tweak" --author="Teacher <teacher@test.local>"', {
    cwd: root,
    stdio: "pipe",
  });
  const result = checkPerimeter(root, manifest, { baseRef: "HEAD~1", ci: true });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => !v.advisoryOnly));
});
