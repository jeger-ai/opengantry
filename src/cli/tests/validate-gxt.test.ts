import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { getRepoRoot } from "../lib/git.js";
import { writeBypassGitNote } from "../lib/break-glass.js";
import { gitInitCommit, gitCommit } from "./test-fixtures.js";
import { TEACHER_EMAIL } from "./test-shared.js";

function copyValidateGxtScripts(dest: string, ogRoot: string): string {
  const script = path.join(ogRoot, "scripts", "validate-gxt.sh");
  fs.mkdirSync(path.join(dest, "scripts"), { recursive: true });
  fs.copyFileSync(script, path.join(dest, "scripts/validate-gxt.sh"));
  fs.copyFileSync(
    path.join(ogRoot, "scripts/gxt-manifest-lib.mjs"),
    path.join(dest, "scripts/gxt-manifest-lib.mjs"),
  );
  fs.mkdirSync(path.join(dest, ".gitagent/foreman"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent/foreman/MANIFEST.json"),
    path.join(dest, ".gitagent/foreman/MANIFEST.json"),
  );
  return script;
}

test("validate-gxt.sh msn: fails on GXT touch without MSN subject", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-gxt-msn-"));
  fs.writeFileSync(path.join(dest, "README.md"), "r\n", "utf8");
  gitInitCommit(dest, "init", TEACHER_EMAIL);
  const script = copyValidateGxtScripts(dest, ogRoot);
  const baseSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();
  fs.mkdirSync(path.join(dest, ".gitagent"), { recursive: true });
  fs.writeFileSync(path.join(dest, ".gitagent", "touch.txt"), "x\n", "utf8");
  gitCommit(dest, "bad subject no msn", TEACHER_EMAIL);
  const headSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();
  const bad = spawnSync("bash", [script, "msn", baseSha, headSha], {
    cwd: dest,
    encoding: "utf8",
  });
  assert.notEqual(bad.status, 0);

  fs.writeFileSync(path.join(dest, ".gitagent", "touch2.txt"), "y\n", "utf8");
  gitCommit(dest, "[MSN-8888] legislate gxt", TEACHER_EMAIL);
  const headGood = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();
  const good = spawnSync("bash", [script, "msn", headSha, headGood], {
    cwd: dest,
    encoding: "utf8",
  });
  assert.equal(good.status, 0);
});


test("validate-gxt.sh msn: accepts gxt-bypass git note without MSN subject", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-gxt-bypass-note-"));
  fs.writeFileSync(path.join(dest, "README.md"), "init\n", "utf8");
  gitInitCommit(dest, "init", TEACHER_EMAIL);
  const script = copyValidateGxtScripts(dest, ogRoot);
  const baseSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();
  fs.mkdirSync(path.join(dest, ".gitagent"), { recursive: true });
  fs.writeFileSync(path.join(dest, ".gitagent", "touch.txt"), "x\n", "utf8");
  gitCommit(dest, "no msn subject on gxt touch", TEACHER_EMAIL);
  const badSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();
  const bad = spawnSync("bash", [script, "msn", baseSha, badSha], { cwd: dest, encoding: "utf8" });
  assert.notEqual(bad.status, 0);

  writeBypassGitNote(dest, badSha, {
    v: 1,
    reason: "emergency hotfix documented in note",
    ts: new Date().toISOString(),
    msn_id: "MSN-0999",
  });
  const good = spawnSync("bash", [script, "msn", baseSha, badSha], { cwd: dest, encoding: "utf8" });
  assert.equal(good.status, 0, (good.stderr || "") + (good.stdout || ""));
});

test("validate-gxt.sh msn: enforces MSN on MANIFEST tmvc_roots (src/cli)", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-gxt-msn-cli-"));
  fs.writeFileSync(path.join(dest, "README.md"), "r\n", "utf8");
  gitInitCommit(dest, "init", TEACHER_EMAIL);
  const script = copyValidateGxtScripts(dest, ogRoot);
  const baseSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();
  fs.mkdirSync(path.join(dest, "src/cli"), { recursive: true });
  fs.writeFileSync(path.join(dest, "src/cli", "touch.ts"), "export {}\n", "utf8");
  gitCommit(dest, "no msn on cli touch", TEACHER_EMAIL);
  const headSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();
  const bad = spawnSync("bash", [script, "msn", baseSha, headSha], { cwd: dest, encoding: "utf8" });
  assert.notEqual(bad.status, 0);

  fs.writeFileSync(path.join(dest, "src/cli", "touch2.ts"), "export const x = 1\n", "utf8");
  gitCommit(dest, "[MSN-7777] gantry cli change", TEACHER_EMAIL);
  const headGood = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();
  const good = spawnSync("bash", [script, "msn", headSha, headGood], { cwd: dest, encoding: "utf8" });
  assert.equal(good.status, 0, (good.stderr || "") + (good.stdout || ""));
});

test("gxt-manifest-lib.mjs: lists src/cli from specimen MANIFEST", () => {
  const ogRoot = getRepoRoot();
  const out = execSync(`node scripts/gxt-manifest-lib.mjs prefixes "${ogRoot}"`, {
    cwd: ogRoot,
    encoding: "utf8",
  });
  assert.match(out, /src\/cli\//);
  assert.match(out, /\.gitagent\//);
});

