import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from "node:child_process";
import { getRepoRoot, gitBlobAt, gitRun, gitRunOk, setGitSpawnForTests, withoutGitRepoEnv, GIT_REPO_LOCATION_ENV } from "../src/git.js";

function tempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-git-pkg-"));
  for (const args of [["init", "-q"], ["config", "user.email", "t@example.test"], ["config", "user.name", "t"], ["config", "commit.gpgsign", "false"]]) {
    const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  }
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  spawnSync("git", ["-C", dir, "add", "-A"], { encoding: "utf8" });
  spawnSync("git", ["-C", dir, "commit", "-q", "-m", "init"], { encoding: "utf8" });
  return dir;
}

test("getRepoRoot resolves the work tree and gitRun returns stdout", () => {
  const dir = tempRepo();
  try {
    assert.equal(fs.realpathSync(getRepoRoot(dir)), fs.realpathSync(dir));
    const head = gitRunOk(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
    assert.equal(head.ok, true);
    assert.equal(head.stdout.trim().length > 0, true);
    const bad = gitRunOk(dir, ["rev-parse", "--verify", "does-not-exist"]);
    assert.equal(bad.ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("withoutGitRepoEnv strips every repository-location variable and nothing else", () => {
  const env = { PATH: "/bin", GIT_DIR: "/x/.git", GIT_WORK_TREE: "/x", GIT_CONFIG_COUNT: "1" };
  const out = withoutGitRepoEnv(env);
  for (const k of GIT_REPO_LOCATION_ENV) assert.equal(k in out, false);
  assert.equal(out.PATH, "/bin");
  assert.equal(out.GIT_CONFIG_COUNT, "1");
});

/** Real git, then `report` rewrites what spawnSync returned (MSN-0389 seam). */
function spawnReporting(report: (r: SpawnSyncReturns<string | Buffer>) => Partial<SpawnSyncReturns<string | Buffer>>) {
  return (command: string, args: string[], options: SpawnSyncOptions): SpawnSyncReturns<string | Buffer> => {
    const r = spawnSync(command, args, options);
    return { ...r, ...report(r) };
  };
}
const cut = (o: string | Buffer, n: number): string | Buffer => (typeof o === "string" ? o.slice(0, n) : o.subarray(0, n));

test("gitRun fails when spawnSync reports status 0 with ENOBUFS, and never returns the cut stdout (MSN-0389)", () => {
  const dir = tempRepo();
  try {
    for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(dir, `f${String(i)}.txt`), "x\n");
    spawnSync("git", ["-C", dir, "add", "-A"], { encoding: "utf8" });
    const full = gitRun(dir, ["ls-files", "--cached"]);
    assert.equal(full.ok, true);

    const enobufs = Object.assign(new Error("spawnSync git ENOBUFS"), { code: "ENOBUFS" });
    setGitSpawnForTests(spawnReporting((r) => ({ stdout: cut(r.stdout, 12), status: 0, signal: null, error: enobufs })));
    const truncated = gitRun(dir, ["ls-files", "--cached"]);
    assert.equal(truncated.ok, false, "status 0 with ENOBUFS is a failure");
    assert.equal(truncated.stdout, "", "no partial stdout");
    assert.equal(truncated.status, null);
    assert.match(truncated.stderr, /ENOBUFS/);
    assert.equal(gitRunOk(dir, ["ls-files", "--cached"]).ok, false);

    const enoent = Object.assign(new Error("spawnSync git ENOENT"), { code: "ENOENT" });
    setGitSpawnForTests(spawnReporting(() => ({ stdout: "", stderr: "", status: null, signal: null, error: enoent })));
    const missing = gitRun(dir, ["rev-parse", "HEAD"]);
    assert.deepEqual([missing.ok, missing.stdout], [false, ""]);
    assert.match(missing.stderr, /ENOENT/);

    setGitSpawnForTests(spawnReporting(() => ({ status: null, signal: "SIGKILL" })));
    const killed = gitRun(dir, ["ls-files", "--cached"]);
    assert.equal(killed.ok, false);
    assert.match(killed.stderr, /SIGKILL/);
  } finally {
    setGitSpawnForTests(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("gitBlobAt: a path git would not list as written is an error, never \"absent\" (MSN-0389 review)", () => {
  const dir = tempRepo();
  assert.deepEqual(gitBlobAt(dir, "HEAD", "a.txt"), { ok: true, text: "a\n" });
  for (const rel of ["./a.txt", "a.txt/", "./", "", "/a.txt", "x//a.txt", "x/../a.txt"]) {
    assert.equal(gitBlobAt(dir, "HEAD", rel).ok, false, JSON.stringify(rel));
  }
  assert.deepEqual(gitBlobAt(dir, "HEAD", "missing.txt"), { ok: true, text: null });
});
