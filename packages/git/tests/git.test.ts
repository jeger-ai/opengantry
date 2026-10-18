import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getRepoRoot, gitRunOk, withoutGitRepoEnv, GIT_REPO_LOCATION_ENV } from "../src/git.js";

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
