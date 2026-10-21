import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { ZERO_SHA, parsePrePushRefLines, pushRangesFromRefLines } from "#missions/git/git-hooks.js";
import { getRepoRoot } from "#git/git.js";

const CLI = path.join(getRepoRoot(), "dist", "cli", "index.js");

function tempRepo(branch = "feature/x"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-hook-"));
  const run = (cmd: string) => execSync(cmd, { cwd: dir, stdio: "pipe" });
  run("git init -q -b main");
  run('git config user.email "t@example.test" && git config user.name t && git config commit.gpgsign false');
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  run("git add a.txt && git commit -q -m one");
  fs.writeFileSync(path.join(dir, "a.txt"), "b\n");
  run("git commit -q -am two");
  if (branch !== "main") {
    run(`git checkout -q -b ${branch}`);
    fs.writeFileSync(path.join(dir, "b.txt"), "b\n");
    run("git add b.txt && git commit -q -m three");
  }
  return dir;
}

function sha(dir: string, ref: string): string {
  return execSync(`git rev-parse ${ref}`, { cwd: dir, encoding: "utf8" }).trim();
}

function cli(dir: string, args: string[], input = ""): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: "utf8", input, env: { ...process.env, NO_COLOR: "1" } });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

test("parsePrePushRefLines keeps well-formed ref lines and drops the rest", () => {
  const a = "a".repeat(40);
  const lines = parsePrePushRefLines(`refs/heads/x ${a} refs/heads/x ${ZERO_SHA}\n\nnot a line\nrefs/heads/y ${a} refs/heads/y ${a} extra\n`);
  assert.deepEqual(lines, [{ localRef: "refs/heads/x", localSha: a, remoteRef: "refs/heads/x", remoteSha: ZERO_SHA }]);
});

test("pushRangesFromRefLines: deletion contributes nothing, update is remote..local, new ref falls back to the parent", () => {
  const dir = tempRepo();
  const head = sha(dir, "HEAD");
  const parent = sha(dir, "HEAD~1");
  const del = { localRef: "(delete)", localSha: ZERO_SHA, remoteRef: "refs/heads/old", remoteSha: head };
  const upd = { localRef: "refs/heads/x", localSha: head, remoteRef: "refs/heads/x", remoteSha: parent };
  assert.deepEqual(pushRangesFromRefLines(dir, [del]), []);
  assert.deepEqual(pushRangesFromRefLines(dir, [upd]), [{ base: parent, head }]);
  const fresh = { localRef: "refs/heads/x", localSha: head, remoteRef: "refs/heads/x", remoteSha: ZERO_SHA };
  assert.deepEqual(pushRangesFromRefLines(dir, [fresh]), [{ base: sha(dir, "main"), head }]);
});

test("pushRangesFromRefLines: a new ref from the remote's main starts at that merge-base when local main lags", () => {
  const dir = tempRepo("main");
  const run = (cmd: string) => execSync(cmd, { cwd: dir, stdio: "pipe" });
  fs.writeFileSync(path.join(dir, "merged.txt"), "already merged\n");
  run("git add merged.txt && git commit -q -m merged");
  const remoteMain = sha(dir, "HEAD");
  run(`git update-ref refs/remotes/upstream/main ${remoteMain}`);
  run("git reset -q --hard HEAD~1");
  run("git checkout -q -b feature/y refs/remotes/upstream/main");
  fs.writeFileSync(path.join(dir, "c.txt"), "c\n");
  run("git add c.txt && git commit -q -m four");
  const head = sha(dir, "HEAD");
  const fresh = { localRef: "refs/heads/feature/y", localSha: head, remoteRef: "refs/heads/feature/y", remoteSha: ZERO_SHA };
  assert.deepEqual(pushRangesFromRefLines(dir, [fresh], "upstream"), [{ base: remoteMain, head }]);
  // A remote-tracking ref older than local main loses to it: the newest merge-base wins.
  run(`git update-ref refs/remotes/upstream/main ${sha(dir, "main~1")}`);
  assert.deepEqual(pushRangesFromRefLines(dir, [fresh], "upstream"), [{ base: sha(dir, "main"), head }]);
});

test("pushRangesFromRefLines: an update after merging the remote's main starts at that main, not the old remote sha", () => {
  const dir = tempRepo();
  const run = (cmd: string) => execSync(cmd, { cwd: dir, stdio: "pipe" });
  const pushed = sha(dir, "HEAD");
  run("git checkout -q main");
  fs.writeFileSync(path.join(dir, "merged.txt"), "merged on main\n");
  run("git add merged.txt && git commit -q -m merged");
  run(`git update-ref refs/remotes/origin/main ${sha(dir, "HEAD")}`);
  run("git checkout -q feature/x && git merge -q --no-edit refs/remotes/origin/main");
  const head = sha(dir, "HEAD");
  const upd = { localRef: "refs/heads/feature/x", localSha: head, remoteRef: "refs/heads/feature/x", remoteSha: pushed };
  assert.deepEqual(pushRangesFromRefLines(dir, [upd], "origin"), [{ base: sha(dir, "refs/remotes/origin/main"), head }]);
});

test("gantry hook pre-push: a ref deletion exits 0 without verifying; a range without missions passes", () => {
  const dir = tempRepo();
  const head = sha(dir, "HEAD");
  const deletion = cli(dir, ["hook", "pre-push", "origin", "git@example.test:o/r.git"], `(delete) ${ZERO_SHA} refs/heads/old ${head}\n`);
  assert.equal(deletion.status, 0);
  assert.match(deletion.out, /nothing to verify/);
  const update = cli(dir, ["hook", "pre-push", "origin", "git@example.test:o/r.git"], `refs/heads/x ${head} refs/heads/x ${sha(dir, "HEAD~1")}\n`);
  assert.equal(update.status, 0, update.out);
});

test("gantry hook pre-commit without a pinned mission is a no-op that exits 0", () => {
  const dir = tempRepo();
  const r = cli(dir, ["hook", "pre-commit"]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /no pinned mission/);
});

test("gantry hook post-checkout creates EXECUTOR_LOG.md on a feature branch and leaves main alone", () => {
  const feature = tempRepo();
  assert.equal(cli(feature, ["hook", "post-checkout", "0".repeat(40), sha(feature, "HEAD"), "1"]).status, 0);
  assert.ok(fs.existsSync(path.join(feature, "EXECUTOR_LOG.md")));
  const onMain = tempRepo("main");
  assert.equal(cli(onMain, ["hook", "post-checkout", "0".repeat(40), sha(onMain, "HEAD"), "1"]).status, 0);
  assert.ok(!fs.existsSync(path.join(onMain, "EXECUTOR_LOG.md")));
  const fileCheckout = tempRepo();
  assert.equal(cli(fileCheckout, ["hook", "post-checkout", "0".repeat(40), sha(fileCheckout, "HEAD"), "0"]).status, 0);
  assert.ok(!fs.existsSync(path.join(fileCheckout, "EXECUTOR_LOG.md")));
});
