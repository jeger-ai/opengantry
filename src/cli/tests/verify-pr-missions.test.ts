import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { getRepoRoot } from "../lib/git.js";
import { gitInitCommit, gitCommit } from "./test-fixtures.js";
import { TEACHER_EMAIL } from "./test-shared.js";

function copyVerifyPrScripts(dest: string, ogRoot: string): string {
  const script = path.join(ogRoot, "scripts", "verify-pr-missions.sh");
  fs.mkdirSync(path.join(dest, "scripts"), { recursive: true });
  fs.copyFileSync(script, path.join(dest, "scripts/verify-pr-missions.sh"));
  fs.copyFileSync(
    path.join(ogRoot, "scripts/gxt-manifest-lib.mjs"),
    path.join(dest, "scripts/gxt-manifest-lib.mjs"),
  );
  fs.mkdirSync(path.join(dest, ".gitagent/foreman"), { recursive: true });
  fs.mkdirSync(path.join(dest, ".gitagent/missions"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent/foreman/MANIFEST.json"),
    path.join(dest, ".gitagent/foreman/MANIFEST.json"),
  );
  fs.writeFileSync(path.join(dest, ".gitagent/missions/README.md"), "# missions\n", "utf8");
  fs.mkdirSync(path.join(dest, "dist/cli"), { recursive: true });
  const cli = path.join(ogRoot, "dist/cli/index.js");
  if (fs.existsSync(cli)) {
    fs.symlinkSync(cli, path.join(dest, "dist/cli/index.js"));
  }
  return script;
}

function initRepoWithScripts(dest: string, ogRoot: string): string {
  fs.writeFileSync(path.join(dest, "README.md"), "init\n", "utf8");
  const script = copyVerifyPrScripts(dest, ogRoot);
  gitInitCommit(dest, "init", TEACHER_EMAIL);
  return script;
}

test("verify-pr-missions.sh: fails on mission contamination (multiple MSNs in range)", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-pr-contam-"));
  const script = initRepoWithScripts(dest, ogRoot);
  const baseSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();

  fs.mkdirSync(path.join(dest, ".gitagent"), { recursive: true });
  fs.writeFileSync(path.join(dest, ".gitagent", "a.txt"), "1\n", "utf8");
  gitCommit(dest, "[MSN-0022] first mission touch", TEACHER_EMAIL);

  fs.writeFileSync(path.join(dest, ".gitagent", "b.txt"), "2\n", "utf8");
  gitCommit(dest, "[MSN-0023] second mission touch", TEACHER_EMAIL);
  const headSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();

  const bad = spawnSync("bash", [script, baseSha, headSha], { cwd: dest, encoding: "utf8" });
  assert.notEqual(bad.status, 0);
  assert.match((bad.stderr || "") + (bad.stdout || ""), /contamination/i);
  assert.match((bad.stderr || "") + (bad.stdout || ""), /MSN-0022/);
  assert.match((bad.stderr || "") + (bad.stdout || ""), /MSN-0023/);
});

test("verify-pr-missions.sh: allows repeated same MSN in commit range", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-pr-same-msn-"));
  const script = initRepoWithScripts(dest, ogRoot);
  const baseSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();

  fs.writeFileSync(path.join(dest, "README.md"), "change 1\n", "utf8");
  gitCommit(dest, "[MSN-0025] doc update one", TEACHER_EMAIL);
  fs.writeFileSync(path.join(dest, "README.md"), "change 2\n", "utf8");
  gitCommit(dest, "[MSN-0025] doc update two", TEACHER_EMAIL);
  const headSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();

  const run = spawnSync("bash", [script, baseSha, headSha], { cwd: dest, encoding: "utf8" });
  assert.equal(run.status, 0, (run.stderr || "") + (run.stdout || ""));
});

test("verify-pr-missions.sh: passes with zero MSN tags in range", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-pr-no-msn-"));
  const script = initRepoWithScripts(dest, ogRoot);
  const baseSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();

  fs.writeFileSync(path.join(dest, "README.md"), "docs only\n", "utf8");
  gitCommit(dest, "chore: readme tweak", TEACHER_EMAIL);
  const headSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();

  const run = spawnSync("bash", [script, baseSha, headSha], { cwd: dest, encoding: "utf8" });
  assert.equal(run.status, 0, (run.stderr || "") + (run.stdout || ""));
});

test("verify-pr-missions.sh: fails when changed mission file mismatches commit MSN", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-pr-mismatch-"));
  const script = initRepoWithScripts(dest, ogRoot);
  const baseSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();

  fs.mkdirSync(path.join(dest, ".gitagent/missions"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, ".gitagent/missions", "MSN-0022.wrong-mission.yaml"),
    "msn_id: MSN-0022\nskill_key: gantry\ngate_command: echo OK\ngate_success_substring: OK\ntrace_rows: []\n",
    "utf8",
  );
  gitCommit(dest, "[MSN-0025] legislate mismatched mission file", TEACHER_EMAIL);
  const headSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();

  const bad = spawnSync("bash", [script, baseSha, headSha], { cwd: dest, encoding: "utf8" });
  assert.notEqual(bad.status, 0);
  assert.match((bad.stderr || "") + (bad.stdout || ""), /does not match commit MSN/i);
});
