import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { getRepoRoot } from "#git/git.js";
import { writeBypassGitNote } from "../lib/break-glass.js";
import { gitInitCommit, gitCommit } from "./test-fixtures.js";
import { PLANNER_EMAIL } from "./test-shared.js";
import { loadManifest } from "../lib/manifest.js";
import { manifestMsnEnforcedPrefixes } from "../lib/trusted-automation.js";

const CLI = path.join(getRepoRoot(), "dist", "cli", "index.js");

function cli(dest: string, args: string[]): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dest, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function repoWithManifest(prefix: string): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(dest, "README.md"), "r\n", "utf8");
  fs.mkdirSync(path.join(dest, ".gitagent/foreman"), { recursive: true });
  fs.copyFileSync(path.join(getRepoRoot(), ".gitagent/foreman/MANIFEST.yaml"), path.join(dest, ".gitagent/foreman/MANIFEST.yaml"));
  gitInitCommit(dest, "init", PLANNER_EMAIL);
  return dest;
}

function head(dest: string): string {
  return execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();
}

test("ci msn-range: fails on a .gitagent touch without an [MSN] subject, passes with one", () => {
  const dest = repoWithManifest("og-ci-msn-");
  const baseSha = head(dest);
  fs.writeFileSync(path.join(dest, ".gitagent", "touch.txt"), "x\n", "utf8");
  gitCommit(dest, "bad subject no msn", PLANNER_EMAIL);
  const badSha = head(dest);
  const bad = cli(dest, ["ci", "msn-range", "--base", baseSha, "--head", badSha]);
  assert.notEqual(bad.status, 0);
  assert.match(bad.out, /MSN check FAILED/);

  fs.writeFileSync(path.join(dest, ".gitagent", "touch2.txt"), "y\n", "utf8");
  gitCommit(dest, "[MSN-8888] legislate gxt", PLANNER_EMAIL);
  const good = cli(dest, ["ci", "msn-range", "--base", badSha, "--head", head(dest)]);
  assert.equal(good.status, 0, good.out);
  assert.match(good.out, /MSN commit subjects OK/);
});

test("ci msn-range: accepts a gxt-bypass git note without an [MSN] subject", () => {
  const dest = repoWithManifest("og-ci-bypass-");
  const baseSha = head(dest);
  fs.writeFileSync(path.join(dest, ".gitagent", "touch.txt"), "x\n", "utf8");
  gitCommit(dest, "no msn subject on gxt touch", PLANNER_EMAIL);
  const badSha = head(dest);
  assert.notEqual(cli(dest, ["ci", "msn-range", "--base", baseSha, "--head", badSha]).status, 0);
  writeBypassGitNote(dest, badSha, { v: 1, reason: "emergency hotfix documented in note", ts: new Date().toISOString(), msn_id: "MSN-0999" });
  const good = cli(dest, ["ci", "msn-range", "--base", baseSha, "--head", badSha]);
  assert.equal(good.status, 0, good.out);
});

test("ci msn-range: enforces the MSN subject on MANIFEST tmvc_roots (src/cli)", () => {
  const dest = repoWithManifest("og-ci-msn-cli-");
  const baseSha = head(dest);
  fs.mkdirSync(path.join(dest, "src/cli"), { recursive: true });
  fs.writeFileSync(path.join(dest, "src/cli", "touch.ts"), "export {}\n", "utf8");
  gitCommit(dest, "no msn on cli touch", PLANNER_EMAIL);
  const badSha = head(dest);
  assert.notEqual(cli(dest, ["ci", "msn-range", "--base", baseSha, "--head", badSha]).status, 0);
  fs.writeFileSync(path.join(dest, "src/cli", "touch2.ts"), "export const x = 1\n", "utf8");
  gitCommit(dest, "[MSN-7777] gantry cli change", PLANNER_EMAIL);
  const good = cli(dest, ["ci", "msn-range", "--base", badSha, "--head", head(dest)]);
  assert.equal(good.status, 0, good.out);
});

test("ci msn-range: BASE_SHA and HEAD_SHA in the environment stand in for the flags; a missing base exits 2", () => {
  const dest = repoWithManifest("og-ci-env-");
  const baseSha = head(dest);
  fs.writeFileSync(path.join(dest, "README.md"), "changed\n", "utf8");
  gitCommit(dest, "docs only", PLANNER_EMAIL);
  const r = spawnSync(process.execPath, [CLI, "ci", "msn-range"], { cwd: dest, encoding: "utf8", env: { ...process.env, BASE_SHA: baseSha, HEAD_SHA: head(dest) } });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const missing = spawnSync(process.execPath, [CLI, "ci", "msn-range"], { cwd: dest, encoding: "utf8", env: { ...process.env, BASE_SHA: "", HEAD_SHA: "" } });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr ?? "", /--base <ref> is required/);
});

test("ci upgrade-tmp: passes on a clean repo", () => {
  const dest = repoWithManifest("og-ci-upgrade-tmp-");
  const r = cli(dest, ["ci", "upgrade-tmp"]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /upgrade-tmp OK/);
});

test("MSN-enforced prefixes: the specimen manifest lists src/cli and the fixed substrate paths", () => {
  const prefixes = manifestMsnEnforcedPrefixes(loadManifest(getRepoRoot()));
  assert.ok(prefixes.includes("src/cli/"));
  assert.ok(prefixes.includes(".gitagent/"));
  assert.ok(prefixes.includes("EXECUTOR_LOG.md"));
});
