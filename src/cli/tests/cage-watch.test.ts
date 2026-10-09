import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getRepoRoot, gitChildEnv } from "../lib/git/git.js";
import { runCage } from "../lib/cage/cage-run.js";
import { CAGE_CONTEST_LIMIT } from "../lib/cage/cage-watch.js";
import { CAGE_LIMITS, CAGE_WATCH_LIMITS, CAGE_WATCH_LIMITS_SUMMARY, formatCageReport } from "../lib/cage/cage-report.js";

const SECRET = "TOKEN=SECRET-MARKER-91c2";
const FAST = 40;

/** Caged command: a `node -e` script with sleep(ms) available, run with the fixture as cwd. */
function nodeScript(body: string): string[] {
  const prelude = 'const fs = require("fs"); const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);';
  return [process.execPath, "-e", `${prelude}\n${body}`];
}

function makeRepo(prefix: string): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dest, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(dest, ".github", "workflows", "ci.yml"), "on: push\n");
  fs.writeFileSync(path.join(dest, ".env"), `${SECRET}\n`);
  fs.writeFileSync(path.join(dest, "package-lock.json"), "{}\n");
  return dest;
}

function read(dest: string, rel: string): string {
  return fs.readFileSync(path.join(dest, rel), "utf8");
}

test("cage watch: protected writes are restored during the session; lockfiles are left alone (DoD 1)", async () => {
  const dest = makeRepo("og-cage-live-");
  const report = await runCage({
    cwd: dest,
    watchIntervalMs: FAST,
    bell: () => {},
    command: nodeScript(`
      fs.writeFileSync(".env", "TOKEN=agent\\n");
      fs.writeFileSync("package-lock.json", "{\\"a\\":1}\\n");
      sleep(600);
      fs.writeFileSync("probe-env.txt", fs.readFileSync(".env", "utf8"));
      fs.writeFileSync("probe-lock.txt", fs.readFileSync("package-lock.json", "utf8"));
    `),
  });
  assert.equal(read(dest, "probe-env.txt"), `${SECRET}\n`, ".env was restored while the command was still running");
  assert.equal(read(dest, "probe-lock.txt"), "{\"a\":1}\n", "lockfile change is not reverted live");
  assert.equal(report.watch.enabled, true);
  assert.ok(report.watch.live_restores >= 1);
  assert.equal(report.status, "violations_reverted");
  assert.equal(report.exit_code, 3);
  const byPath = new Map(report.changes.map((c) => [c.path, c]));
  assert.equal(byPath.get(".env")?.outcome, "reverted");
  assert.equal(byPath.get("package-lock.json")?.outcome, "kept");
});

test("cage watch: a path rewritten again after 3 live restores is contested and restored once at exit (DoD 2)", async () => {
  const dest = makeRepo("og-cage-contest-");
  const report = await runCage({
    cwd: dest,
    watchIntervalMs: FAST,
    bell: () => {},
    command: nodeScript(`
      for (let i = 0; i < 6; i++) { fs.writeFileSync(".env", "TOKEN=agent-" + i + "\\n"); sleep(300); }
      fs.writeFileSync("probe-env.txt", fs.readFileSync(".env", "utf8"));
    `),
  });
  assert.equal(report.watch.live_restores, CAGE_CONTEST_LIMIT);
  assert.deepEqual(report.watch.contested, [".env"]);
  assert.equal(read(dest, "probe-env.txt"), "TOKEN=agent-5\n", "no live restore once contested");
  assert.equal(read(dest, ".env"), `${SECRET}\n`, "restored at exit");
  assert.equal(report.exit_code, 3);
  assert.ok(formatCageReport(report).some((l) => l.startsWith("cage: contested") && l.includes(".env")));
});

test("cage CLI watch: one start line naming the session log, only bells while running, events logged without bodies (DoD 3)", () => {
  const cli = path.join(getRepoRoot(), "dist", "cli", "index.js");
  const dest = makeRepo("og-cage-log-");
  const r = spawnSync(
    process.execPath,
    [cli, "cage", "--watch-interval-ms", String(FAST), "--", ...nodeScript(`fs.writeFileSync(".env", "TOKEN=agent\\n"); sleep(500);`)],
    { cwd: dest, encoding: "utf8", env: gitChildEnv() },
  );
  assert.equal(r.status, 3, r.stderr);
  const lines = r.stderr.split("\n");
  const start = lines[0]!;
  assert.match(start, /^cage: watching \d+ protected file\(s\); live events: (.+)$/);
  const logPath = /live events: (.+)$/.exec(start)![1]!;
  const beforeReport = r.stderr.slice(start.length + 1, r.stderr.indexOf("cage: violations"));
  const BELL = String.fromCharCode(7);
  assert.ok(beforeReport.length > 0 && [...beforeReport].every((ch) => ch === BELL), `only bells while running, got ${JSON.stringify(beforeReport)}`);
  const events = fs.readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
  assert.ok(events.some((e) => e.event === "restored" && e.path === ".env" && e.rule === "secrets"));
  assert.ok(!fs.readFileSync(logPath, "utf8").includes("SECRET-MARKER"), "no file bodies in the session log");
  assert.ok(!fs.realpathSync(logPath).startsWith(fs.realpathSync(dest)), "session log lives outside the repo");
});

test("cage watch limits: watch-mode report states live-restore limits (DoD 3)", async () => {
  const report = await runCage({ cwd: makeRepo("og-cage-wlimits-"), command: nodeScript(""), bell: () => {} });
  assert.deepEqual(report.limits, CAGE_WATCH_LIMITS);
  assert.ok(formatCageReport(report).includes(`cage: exit 0; limits: ${CAGE_WATCH_LIMITS_SUMMARY}`));
});

test("cage --no-watch: no live restore; restored only at exit with after-exit limits (DoD 4)", async () => {
  const dest = makeRepo("og-cage-nowatch-");
  const report = await runCage({
    cwd: dest,
    watch: false,
    watchIntervalMs: FAST,
    command: nodeScript(`
      fs.writeFileSync(".env", "TOKEN=agent\\n");
      sleep(400);
      fs.writeFileSync("probe-env.txt", fs.readFileSync(".env", "utf8"));
    `),
  });
  assert.equal(read(dest, "probe-env.txt"), "TOKEN=agent\n");
  assert.equal(report.watch.enabled, false);
  assert.equal(report.watch.live_restores, 0);
  assert.equal(read(dest, ".env"), `${SECRET}\n`);
  assert.deepEqual(report.limits, CAGE_LIMITS);
  assert.equal(report.exit_code, 3);
});

function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: gitChildEnv() });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function makeRepoWithRemote(): { dest: string; remote: string; marker: string } {
  const dest = makeRepo("og-cage-push-");
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-remote-"));
  git(remote, ["init", "-q", "--bare", "-b", "main"]);
  git(dest, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(dest, "README.md"), "demo\n");
  fs.writeFileSync(path.join(dest, ".gitignore"), ".env\nprobe-*\n");
  git(dest, ["add", "-A"]);
  git(dest, ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-qm", "init"]);
  git(dest, ["remote", "add", "origin", remote]);
  git(dest, ["push", "-q", "origin", "main"]);
  const marker = path.join(os.tmpdir(), `og-cage-hook-ran-${String(process.pid)}-${String(Date.now())}`);
  fs.writeFileSync(path.join(dest, ".git", "hooks", "pre-push"), `#!/bin/sh\ncat >/dev/null\ntouch '${marker}'\nexit 0\n`, { mode: 0o755 });
  return { dest, remote, marker };
}

test("cage push guard: refuses pushes of protected paths, chains the repo's own hooks, leaves no trace (DoD 5)", async () => {
  const { dest, remote, marker } = makeRepoWithRemote();
  const tmpHooksBefore = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("gantry-cage-hooks-"));
  const configBefore = read(dest, ".git/config");
  const g = 'git -c user.email=t@example.com -c user.name=t -c commit.gpgsign=false';
  const script = [
    `echo more >> README.md && ${g} commit -qam ok && git push -q origin HEAD:main; echo $? > probe-push-ok`,
    `echo evil >> .github/workflows/ci.yml && ${g} commit -qam evil && git push -q origin HEAD:main; echo $? > probe-push-ci`,
    `git push -q origin HEAD:refs/heads/evil-branch; echo $? > probe-push-new`,
  ].join("\n");
  const report = await runCage({ cwd: dest, watch: false, command: ["sh", "-c", script] });

  assert.equal(read(dest, "probe-push-ok").trim(), "0", "unprotected push goes through");
  assert.notEqual(read(dest, "probe-push-ci").trim(), "0", "push of a CI change is refused");
  assert.notEqual(read(dest, "probe-push-new").trim(), "0", "new-branch push of a CI change is refused");
  assert.ok(fs.existsSync(marker), "the repo's own pre-push hook still ran");
  const remoteLog = git(remote, ["log", "--format=%s", "main"]);
  assert.match(remoteLog, /^ok$/m);
  assert.doesNotMatch(remoteLog, /evil/);
  assert.equal(git(remote, ["branch", "--list", "evil-branch"]), "");

  assert.equal(report.push_guard.enabled, true);
  assert.equal(report.push_guard.refused_pushes, 2);
  assert.equal(read(dest, ".git/config"), configBefore, "no core.hooksPath written to the repo");
  const tmpHooksAfter = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("gantry-cage-hooks-"));
  assert.deepEqual(tmpHooksAfter, tmpHooksBefore, "session hooks dir removed at exit");
  assert.ok(formatCageReport(report).some((l) => l === "cage: refused 2 push(es) touching protected paths"));
});

test("cage push guard: checks the session plan, so .cage.yaml paths and globs are refused and overrides go through (MSN-0239 DoD 7)", async () => {
  const { dest, remote } = makeRepoWithRemote();
  fs.writeFileSync(path.join(dest, ".cage.yaml"), 'protect:\n  - path: infra\n  - glob: "**/*.pem"\n');
  const g = 'git -c user.email=t@example.com -c user.name=t -c commit.gpgsign=false';
  const branch = (name: string, rel: string): string =>
    [
      `git checkout -q main && git checkout -q -b ${name}`,
      `mkdir -p "$(dirname ${rel})" && echo x > ${rel} && ${g} add ${rel} && ${g} commit -qm ${name}`,
      `git push -q origin HEAD:refs/heads/${name}; echo $? > probe-${name}`,
    ].join(" && ");
  const script = [
    branch("override", "infra/ok/a.tf"),
    branch("pem", "keys/deep/server.pem"),
    branch("infra", "infra/main.tf"),
    // The agent removes its own protect entry; the guard still uses the plan the session started with.
    `printf 'protect: []\\n' > .cage.yaml`,
    branch("after", "infra/later.tf"),
  ].join("\n");
  const report = await runCage({ cwd: dest, watch: false, allowOverride: ["infra/ok"], command: ["sh", "-c", script] });

  assert.equal(read(dest, "probe-override").trim(), "0", "overridden path is pushed");
  assert.notEqual(read(dest, "probe-pem").trim(), "0", "glob-protected path is refused");
  assert.notEqual(read(dest, "probe-infra").trim(), "0", "path-protected tree is refused");
  assert.notEqual(read(dest, "probe-after").trim(), "0", "editing .cage.yaml mid-session does not loosen the guard");
  const branches = git(remote, ["branch", "--list", "--format=%(refname:short)"]).split("\n").sort();
  assert.deepEqual(branches, ["main", "override"]);
  assert.equal(report.push_guard.refused_pushes, 3);
  assert.equal(read(dest, ".cage.yaml"), 'protect:\n  - path: infra\n  - glob: "**/*.pem"\n', "config restored at exit");
});
