import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { GIT_REPO_LOCATION_ENV, gitChildEnv, withoutGitRepoEnv } from "#git/git.js";
import { runGate } from "../lib/gate.js";
import { spawnGateStreaming } from "../lib/gate-adapters/spawn-stream-core.js";

/**
 * MSN-0266. git sets GIT_DIR for hooks run in a linked worktree. The pre-push hook runs gantry verify, and the gate
 * used to inherit that GIT_DIR, so test fixtures that ran `git init` or `git config` in a temp dir wrote to the real
 * repository instead (core.bare=true, a Fixture identity, pushes to its origin). Every repository here is a temp dir.
 */

const GATE_LIB = fileURLToPath(new URL("../lib/gate.js", import.meta.url));
const PRELOAD = fileURLToPath(new URL("./test-tmpdir-setup.js", import.meta.url));
/** What the leaking fixtures did: initialise a repo in a fresh temp dir and write config there. */
const FIXTURE_GATE = `d="$(mktemp -d)" && cd "$d" && git init -q && git config user.name Fixture && git rev-parse --absolute-git-dir`;

function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, env: gitChildEnv(), encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function tmp(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** A repo whose config must survive: any write a leaked gate makes lands here. */
function sentinelRepo(): { dir: string; gitDir: string; config: () => string } {
  const dir = tmp("og-gate-env-sentinel-");
  git(dir, ["init", "-q"]);
  const gitDir = path.join(dir, ".git");
  return { dir, gitDir, config: () => fs.readFileSync(path.join(gitDir, "config"), "utf8") };
}

/** Runs `fn` with GIT_DIR (and the index next to it) pointing at the sentinel, as a worktree hook would. */
async function withSentinelEnv<T>(gitDir: string, fn: () => T | Promise<T>): Promise<T> {
  const saved = { GIT_DIR: process.env.GIT_DIR, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE };
  process.env.GIT_DIR = gitDir;
  process.env.GIT_INDEX_FILE = path.join(gitDir, "index");
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function assertUntouched(sentinel: { config: () => string }, before: string): void {
  const after = sentinel.config();
  assert.equal(after, before, "the sentinel repository's config is unchanged");
  assert.doesNotMatch(after, /Fixture/);
  assert.doesNotMatch(after, /bare = true/);
}

test("gate git env: runGate does not hand an inherited GIT_DIR to the gate (MSN-0266 DoD 2, DoD 4a)", async () => {
  const sentinel = sentinelRepo();
  const before = sentinel.config();
  const cwd = tmp("og-gate-env-cwd-");
  const result = await withSentinelEnv(sentinel.gitDir, () =>
    runGate(cwd, { command: FIXTURE_GATE, successSubstring: null, adapter: "generic" }),
  );
  assert.equal(result.exitCode, 0, result.combined);
  assert.ok(!result.stdout.trim().startsWith(sentinel.dir), `the gate's git used its own repo: ${result.stdout.trim()}`);
  assertUntouched(sentinel, before);
});

test("gate git env: spawnGateStreaming does not hand an inherited GIT_DIR to the gate (MSN-0266 DoD 2, DoD 4a)", async () => {
  const sentinel = sentinelRepo();
  const before = sentinel.config();
  const cwd = tmp("og-gate-env-stream-");
  const result = await withSentinelEnv(sentinel.gitDir, () =>
    spawnGateStreaming(FIXTURE_GATE, { cwd, gateLogPath: path.join(cwd, "gate.log"), successSubstring: null }, { captureStdout: true }),
  );
  assert.equal(result.exitCode, 0, fs.readFileSync(path.join(cwd, "gate.log"), "utf8"));
  assert.ok(!result.stdout.trim().startsWith(sentinel.dir), `the gate's git used its own repo: ${result.stdout.trim()}`);
  assertUntouched(sentinel, before);
});

test("gate git env: a gate run by a linked worktree's pre-push hook cannot write the main repo's config (MSN-0266 DoD 4b)", () => {
  const base = tmp("og-gate-env-incident-");
  const remote = path.join(base, "remote.git");
  const main = path.join(base, "main");
  const wt = path.join(base, "wt");
  git(base, ["init", "-q", "--bare", remote]);
  git(base, ["init", "-q", main]);
  git(main, ["config", "commit.gpgsign", "false"]);
  git(main, ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "init"]);
  git(main, ["remote", "add", "origin", remote]);

  // The hook does what .githooks/pre-push does through gantry verify: run the gate with the built runGate.
  const hooks = path.join(base, "hooks");
  fs.mkdirSync(hooks);
  const runner = path.join(base, "run-gate.mjs");
  fs.writeFileSync(
    runner,
    `import { runGate } from ${JSON.stringify(GATE_LIB)};\n` +
      `const r = runGate(process.cwd(), { command: ${JSON.stringify(FIXTURE_GATE)}, successSubstring: null, adapter: "generic" });\n` +
      `process.stderr.write("gate git dir: " + r.stdout);\n` +
      `process.exit(r.exitCode ?? 1);\n`,
  );
  fs.writeFileSync(path.join(hooks, "pre-push"), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(runner)}\n`, {
    mode: 0o755,
  });
  git(main, ["config", "core.hooksPath", hooks]);
  git(main, ["worktree", "add", "-q", "-b", "w", wt]);

  const before = fs.readFileSync(path.join(main, ".git", "config"), "utf8");
  const push = spawnSync("git", ["push", "-q", "origin", "HEAD:refs/heads/w"], { cwd: wt, env: gitChildEnv(), encoding: "utf8" });
  assert.equal(push.status, 0, `push from the worktree: ${push.stderr}`);

  const after = fs.readFileSync(path.join(main, ".git", "config"), "utf8");
  assert.equal(after, before, "the main repo's config is unchanged by the hook's gate");
  assert.equal(spawnSync("git", ["config", "--get", "user.name"], { cwd: main, env: { ...gitChildEnv(), HOME: base } }).stdout.toString(), "");
  assert.equal(git(main, ["rev-parse", "--is-bare-repository"]), "false");
});

test("gate git env: the test preload removes repository-locating GIT_ variables (MSN-0266 DoD 3, DoD 4c)", () => {
  const probe = spawnSync(
    process.execPath,
    ["--import", PRELOAD, "-e", `console.log(JSON.stringify(Object.keys(process.env).filter((k) => k.startsWith("GIT_"))))`],
    {
      env: {
        ...process.env,
        GIT_DIR: "/nonexistent/.git",
        GIT_WORK_TREE: "/nonexistent",
        GIT_INDEX_FILE: "/nonexistent/.git/index",
        GIT_COMMON_DIR: "/nonexistent/.git",
        GIT_OBJECT_DIRECTORY: "/nonexistent/.git/objects",
        GIT_ALTERNATE_OBJECT_DIRECTORIES: "/nonexistent/objects",
        GIT_NAMESPACE: "fixture",
        GIT_CONFIG_COUNT: "0",
      },
      encoding: "utf8",
    },
  );
  assert.equal(probe.status, 0, probe.stderr);
  const left = JSON.parse(probe.stdout.trim()) as string[];
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE"]) {
    assert.ok(!left.includes(k), `${k} is removed`);
  }
  assert.ok(left.includes("GIT_CONFIG_COUNT"), "git config variables are kept (cage push guard, ADR-0048 decision 5)");
});

test("gate git env: one shared list; gitChildEnv strips all of it and keeps git config variables (MSN-0266 DoD 1)", () => {
  assert.deepEqual(
    [...GIT_REPO_LOCATION_ENV],
    ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE"],
  );
  const dirty: NodeJS.ProcessEnv = { PATH: "/bin", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: "/h" };
  for (const key of GIT_REPO_LOCATION_ENV) dirty[key] = "/x";
  const clean = withoutGitRepoEnv(dirty);
  for (const key of GIT_REPO_LOCATION_ENV) assert.equal(clean[key], undefined, `${key} removed`);
  assert.equal(clean.GIT_CONFIG_KEY_0, "core.hooksPath");
  assert.equal(dirty.GIT_DIR, "/x", "the input env is not mutated");
  const child = gitChildEnv({ GIT_INDEX_FILE: "/x/index", GIT_COMMON_DIR: "/x" });
  assert.equal(child.GIT_INDEX_FILE, undefined);
  assert.equal(child.GIT_COMMON_DIR, undefined);
  assert.equal(child.GIT_OPTIONAL_LOCKS, "0");
});
