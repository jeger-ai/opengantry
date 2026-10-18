import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { getRepoRoot } from "#git/git.js";
import { gitInitCommit, gitCommit } from "./test-fixtures.js";
import { PLANNER_EMAIL } from "./test-shared.js";

const CLI = path.join(getRepoRoot(), "dist", "cli", "index.js");

function cli(dest: string, args: string[]): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dest, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function initRepo(prefix: string): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(dest, "README.md"), "init\n", "utf8");
  fs.mkdirSync(path.join(dest, ".gitagent/foreman"), { recursive: true });
  fs.mkdirSync(path.join(dest, ".gitagent/missions"), { recursive: true });
  fs.copyFileSync(path.join(getRepoRoot(), ".gitagent/foreman/MANIFEST.yaml"), path.join(dest, ".gitagent/foreman/MANIFEST.yaml"));
  fs.writeFileSync(path.join(dest, ".gitagent/missions/README.md"), "# missions\n", "utf8");
  gitInitCommit(dest, "init", PLANNER_EMAIL);
  return dest;
}

function head(dest: string): string {
  return execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();
}

test("ci verify-missions: fails on mission contamination (multiple MSNs in range)", () => {
  const dest = initRepo("og-ci-vm-contam-");
  const baseSha = head(dest);
  fs.writeFileSync(path.join(dest, ".gitagent", "a.txt"), "1\n", "utf8");
  gitCommit(dest, "[MSN-0022] first mission touch", PLANNER_EMAIL);
  fs.writeFileSync(path.join(dest, ".gitagent", "b.txt"), "2\n", "utf8");
  gitCommit(dest, "[MSN-0023] second mission touch", PLANNER_EMAIL);
  const bad = cli(dest, ["ci", "verify-missions", "--base", baseSha, "--head", head(dest)]);
  assert.notEqual(bad.status, 0);
  assert.match(bad.out, /contamination/i);
  assert.match(bad.out, /MSN-0022/);
  assert.match(bad.out, /MSN-0023/);
});

test("ci verify-missions: allows the same MSN repeated in a range and passes with zero MSN tags", () => {
  const same = initRepo("og-ci-vm-same-");
  const baseSame = head(same);
  fs.writeFileSync(path.join(same, "README.md"), "change 1\n", "utf8");
  gitCommit(same, "[MSN-0025] doc update one", PLANNER_EMAIL);
  fs.writeFileSync(path.join(same, "README.md"), "change 2\n", "utf8");
  gitCommit(same, "[MSN-0025] doc update two", PLANNER_EMAIL);
  const ok = cli(same, ["ci", "verify-missions", "--base", baseSame, "--head", head(same)]);
  assert.equal(ok.status, 0, ok.out);

  const none = initRepo("og-ci-vm-none-");
  const baseNone = head(none);
  fs.writeFileSync(path.join(none, "README.md"), "docs only\n", "utf8");
  gitCommit(none, "chore: readme tweak", PLANNER_EMAIL);
  const r = cli(none, ["ci", "verify-missions", "--base", baseNone, "--head", head(none)]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /no changed mission files/);
});

test("ci verify-missions: fails when the changed mission file does not match the commit MSN", () => {
  const dest = initRepo("og-ci-vm-mismatch-");
  const baseSha = head(dest);
  fs.writeFileSync(
    path.join(dest, ".gitagent/missions", "MSN-0022.wrong-mission.yaml"),
    "msn_id: MSN-0022\nskill_key: gantry\ngate_command: echo OK\ngate_success_substring: OK\ntrace_rows: []\n",
    "utf8",
  );
  gitCommit(dest, "[MSN-0025] legislate mismatched mission file", PLANNER_EMAIL);
  const bad = cli(dest, ["ci", "verify-missions", "--base", baseSha, "--head", head(dest)]);
  assert.notEqual(bad.status, 0);
  assert.match(bad.out, /does not match commit MSN|do not match the range's MSN|no changed mission file matches/i);
});

test("ci verify-missions: a range touching MSN-enforced paths without a mission file fails closed", () => {
  const dest = initRepo("og-ci-vm-required-");
  const baseSha = head(dest);
  fs.writeFileSync(path.join(dest, ".gitagent", "touch.txt"), "x\n", "utf8");
  gitCommit(dest, "[MSN-0030] substrate touch without a mission file", PLANNER_EMAIL);
  const bad = cli(dest, ["ci", "verify-missions", "--base", baseSha, "--head", head(dest)]);
  assert.notEqual(bad.status, 0);
  assert.match(bad.out, /no mission file under \.gitagent\/missions/);
});
