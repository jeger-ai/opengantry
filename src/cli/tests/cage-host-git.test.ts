import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { CageReport } from "#cage/cage-report.js";
import { gitOutput } from "#git/git.js";

const cli = fileURLToPath(new URL("../index.js", import.meta.url));
const bwrap = ["bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--unshare-all"];
const canSandbox = process.platform === "linux" && spawnSync(bwrap[0]!, [...bwrap.slice(1), "--", "/bin/true"]).status === 0;

function fixture(base: string, linked: boolean) {
  const primary = path.join(base, "primary");
  fs.mkdirSync(primary);
  gitOutput(primary, ["init", "-q", "-b", "main"]);
  gitOutput(primary, ["config", "user.name", "Cage host Git test"]);
  gitOutput(primary, ["config", "user.email", "fixture@example.test"]);
  gitOutput(primary, ["config", "commit.gpgsign", "false"]);
  gitOutput(primary, ["config", "core.hooksPath", "/dev/null"]);
  fs.mkdirSync(path.join(primary, "src"));
  fs.writeFileSync(path.join(primary, "src", "task.txt"), "approved\n");
  fs.writeFileSync(path.join(primary, "outside.txt"), "baseline\n");
  fs.writeFileSync(path.join(primary, ".cage.yaml"), "allow_only: ['src/**']\n");
  gitOutput(primary, ["add", "--", "."]);
  gitOutput(primary, ["commit", "-qm", "baseline"]);

  const root = linked ? path.join(base, "linked") : primary;
  if (linked) gitOutput(primary, ["worktree", "add", "-qb", "task", root]);
  const commonDir = gitOutput(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
  const worktreeGitDir = gitOutput(root, ["rev-parse", "--absolute-git-dir"]).trim();
  const hooksDir = path.join(base, "product-hooks");
  fs.mkdirSync(hooksDir);
  gitOutput(root, ["config", "core.hooksPath", hooksDir]);
  const sessionDir = path.join(base, "session");
  fs.mkdirSync(sessionDir);
  const marker = path.join(sessionDir, "product-hook-stdin");
  fs.writeFileSync(path.join(hooksDir, "pre-push"), "#!/bin/sh\ncat > \"$FIXTURE_PUSH_LOG\"\n", { mode: 0o755 });
  fs.writeFileSync(path.join(hooksDir, "post-index-change"), "#!/bin/sh\nprintf '%s\\n' \"$1\" >> \"$FIXTURE_INDEX_LOG\"\n", { mode: 0o755 });

  const remote = path.join(base, "remote.git");
  gitOutput(root, ["clone", "-q", "--bare", "--no-local", root, remote]);
  gitOutput(root, ["remote", "add", "origin", remote]);
  gitOutput(root, ["fetch", "-q", "origin"]);
  const state = path.join(base, "host-state");
  fs.mkdirSync(state, { mode: 0o700 });
  fs.writeFileSync(path.join(state, "identity.json"), JSON.stringify({ root, commonDir, worktreeGitDir, hooksDir }), { mode: 0o600 });
  const gitDir = path.join(state, "git");
  const head = gitOutput(root, ["rev-parse", "HEAD"]).trim();
  gitOutput(root, ["clone", "-q", "--bare", "--no-local", root, gitDir]);
  gitOutput(root, [`--git-dir=${gitDir}`, `--work-tree=${root}`, "read-tree", head]);
  return { root, state, gitDir, commonDir, worktreeGitDir, hooksDir, remote, head, marker, sessionDir, indexLog: path.join(sessionDir, "product-index-log") };
}

function cageSession(repo: ReturnType<typeof fixture>, linked: boolean, sandboxed: boolean) {
  const { root, state, commonDir, remote, marker, sessionDir, indexLog } = repo;
  const env = { ...process.env, TMPDIR: sessionDir, GANTRY_CAGE_HOST_STATE: state, FIXTURE_PUSH_LOG: marker, FIXTURE_INDEX_LOG: indexLog };
  const writable = [root, remote, sessionDir, ...(linked ? [commonDir] : [])];
  const sandboxCommand = [...bwrap, ...writable.flatMap(dir => ["--bind", dir, dir]), "--tmpfs", state, "--die-with-parent", "--",
    "sh", "-ec", 'test ! -e "$1/identity.json" && test ! -e "$1/git/index" || exit 1; shift; exec "$@"', "check-host-state", state];
  const argv = (command: string[]) => [cli, "cage", "--json", "--no-watch", "--", ...(sandboxed ? sandboxCommand : []), ...command];
  const sync = (command: string[]) => spawnSync(process.execPath, argv(command), { cwd: root, env, encoding: "utf8" });
  return { argv, env, sync };
}

function sessionTest(linked: boolean, sandboxed: boolean): void {
  test(`cage host Git preserves snapshots and the push guard in a ${linked ? "linked" : "regular"} worktree${sandboxed ? " with Bubblewrap" : ""}`, {
    skip: process.platform !== "linux" ? "requires Linux" : sandboxed && !canSandbox ? "requires Bubblewrap namespaces" : false,
  }, (t) => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-host-git-")));
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    const repo = fixture(base, linked);
    const { root, gitDir, worktreeGitDir, remote, head, marker, indexLog } = repo;
    const hostIndex = path.join(gitDir, "index");
    const approvedIndex = fs.readFileSync(hostIndex);
    const liveIndex = path.join(worktreeGitDir, "index");
    const liveIndexBefore = fs.readFileSync(liveIndex);
    const { sync: runCage } = cageSession(repo, linked, sandboxed);

    const idle = runCage([process.execPath, "-e", ""]);
    assert.equal(idle.status, 0, idle.stderr);
    const cleanReport = JSON.parse(idle.stdout) as CageReport;
    assert.equal(cleanReport.root, root);
    assert.equal(cleanReport.cage_config.committed, true);
    assert.deepEqual(cleanReport.changes, []);
    assert.deepEqual(fs.readFileSync(liveIndex), liveIndexBefore);
    assert.equal(fs.existsSync(indexLog), false, "host snapshots never invoke the repository's post-index-change hook");
    assert.equal(fs.existsSync(marker), false);

    const run = runCage(["sh", "-ec", [
      'test -z "${GANTRY_CAGE_HOST_STATE+x}"',
      "printf 'task result\\n' > src/task.txt",
      "git add -- src/task.txt",
      "git commit -qm 'task change'",
      "git push -q origin HEAD:refs/heads/task-result",
      "printf 'proposed edit\\n' > outside.txt",
      "git add -- outside.txt",
      "git commit -qm 'out of scope change'",
      "if git push -q origin HEAD:refs/heads/out-of-scope; then exit 1; fi",
      "git reset -q --hard HEAD^",
      "printf 'pending task edit\\n' > src/task.txt",
      "git add -- src/task.txt",
      "printf 'temporary edit\\n' > outside.txt",
    ].join("\n")]);
    assert.equal(run.status, 3, run.stderr);
    const report = JSON.parse(run.stdout) as CageReport;
    assert.equal(report.command_exit_code, 0);
    assert.deepEqual(report.push_guard, { enabled: true, refused_pushes: 1 });
    assert.match(run.stderr, /push refused: outgoing commits change protected paths: outside\.txt/);
    assert.deepEqual(report.changes.map(({ path, outcome }) => [path, outcome]), [["outside.txt", "reverted"]]);
    assert.equal(fs.readFileSync(path.join(root, "outside.txt"), "utf8"), "baseline\n");
    assert.equal(gitOutput(root, ["show", ":src/task.txt"]), "pending task edit\n");
    assert.equal(gitOutput(root, ["-C", remote, "show", "task-result:src/task.txt"]), "task result\n");
    assert.equal(gitOutput(remote, ["for-each-ref", "refs/heads/out-of-scope"]), "");
    assert.match(fs.readFileSync(marker, "utf8"), /^HEAD [a-f0-9]+ refs\/heads\/task-result [a-f0-9]+\n$/);
    assert.ok(fs.existsSync(indexLog), "the agent's own Git commands still invoke product hooks");
    assert.deepEqual(fs.readFileSync(hostIndex), approvedIndex);
    assert.equal(gitOutput(root, [`--git-dir=${gitDir}`, "rev-parse", "HEAD"]).trim(), head);
  });
}

function recoveryTest(linked: boolean): void {
  test(`cage host Git recovers an interrupted Bubblewrap session in a ${linked ? "linked" : "regular"} worktree`, {
    skip: !canSandbox && "requires Bubblewrap namespaces",
  }, async (t) => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-host-recovery-")));
    const repo = fixture(base, linked);
    const { root, hooksDir, sessionDir } = repo;
    const { argv, env, sync } = cageSession(repo, linked, true);
    const holder = spawn(process.execPath, argv(["sh", "-ec", [
      "printf 'interrupted task edit\\n' > outside.txt",
      'touch "$TMPDIR/ready"',
      "exec sleep 30",
    ].join("\n")]), { cwd: root, env, stdio: ["ignore", "ignore", "pipe"] });
    const exited = once(holder, "exit");
    let stderr = "";
    holder.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    t.after(async () => {
      holder.kill("SIGKILL");
      await exited;
      fs.rmSync(base, { recursive: true, force: true });
    });

    const ready = path.join(sessionDir, "ready");
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(ready) && holder.exitCode === null && Date.now() < deadline) await delay(25);
    assert.ok(fs.existsSync(ready), stderr);
    const competing = sync(["sh", "-ec", 'touch "$TMPDIR/competing-ran"']);
    assert.equal(competing.status, 2, competing.stdout + competing.stderr);
    assert.equal((JSON.parse(competing.stdout) as { error_code: string }).error_code, "GXT_CAGE_SESSION_ACTIVE");
    assert.equal(fs.existsSync(path.join(sessionDir, "competing-ran")), false);

    // Change a routine Git setting on disk while the interrupted state is in use.
    gitOutput(root, ["config", "core.hooksPath", "/dev/null"]);
    assert.ok(holder.kill("SIGKILL"));
    assert.deepEqual(await exited, [null, "SIGKILL"]);

    const resumed = sync(["sh", "-ec", "printf 'recovered task edit\\n' > src/task.txt; git add -- src/task.txt"]);
    assert.equal(resumed.status, 0, resumed.stderr);
    const report = JSON.parse(resumed.stdout) as CageReport;
    assert.equal(report.recovery?.previous_pid, holder.pid);
    assert.ok(report.recovery?.restored.some(change => change.path === "outside.txt" && change.outcome === "reverted"));
    assert.equal(fs.readFileSync(path.join(root, "outside.txt"), "utf8"), "baseline\n");
    assert.equal(gitOutput(root, ["config", "core.hooksPath"]).trim(), hooksDir);
    assert.ok(fs.existsSync(repo.indexLog));

    fs.rmSync(repo.indexLog);
    gitOutput(root, ["config", "core.hooksPath", "/dev/null"]);
    const newSession = sync(["sh", "-ec", "printf 'fresh task edit\\n' > src/task.txt; git add -- src/task.txt"]);
    assert.equal(newSession.status, 0, newSession.stderr);
    assert.ok(fs.existsSync(repo.indexLog), "hook selection comes from the approved identity despite the live config setting");
  });
}

for (const linked of [false, true]) {
  sessionTest(linked, false);
  sessionTest(linked, true);
  recoveryTest(linked);
}
