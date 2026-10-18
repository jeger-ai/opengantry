import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { getRepoRoot, gitChildEnv } from "#git/git.js";
import { recoverCageJournal, resolveCageJournalDir } from "#cage/cage-journal.js";
import { runCage } from "#cage/cage-run.js";
import { buildCagePlan, classifyCagePath, inCageScope } from "#cage/cage-rules.js";
import { runCageWatch } from "#cage/cage-watch-run.js";

const SECRET = "TOKEN=SECRET-MARKER-5e0a";
const CLI = path.join(getRepoRoot(), "dist", "cli", "index.js");
const POSIX_ONLY = { skip: process.platform === "win32" ? "sh based" : false };

function git(dest: string, ...args: string[]): string {
  const r = spawnSync(
    "git",
    ["-C", dest, "-c", "user.email=fixture@example.com", "-c", "user.name=Fixture", "-c", "commit.gpgsign=false", ...args],
    { encoding: "utf8", env: gitChildEnv() },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function write(dest: string, rel: string, body: string, mode?: number): void {
  fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
  fs.writeFileSync(path.join(dest, rel), body, mode === undefined ? undefined : { mode });
}

function read(dest: string, rel: string): string | null {
  const p = path.join(dest, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

/**
 * A committed repo: src/billing (the task's area), src/shared, other/, an executable script, a symlink, a lockfile
 * and a gitignored dist/. `.env` is gitignored and inside src/billing. One staged and one untracked change on top.
 */
function makeRepo(prefix: string, cageYaml?: string): string {
  const dest = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  git(dest, "init", "-q", "-b", "main");
  write(dest, "src/billing/invoice.ts", "export const invoice = 1;\n");
  write(dest, "src/shared/util.ts", "export const util = 1;\n");
  write(dest, "other/b.ts", "b\n");
  write(dest, "other/del.ts", "keep me\n");
  write(dest, "run.sh", "#!/bin/sh\necho run\n", 0o755);
  write(dest, "package-lock.json", "{}\n");
  write(dest, ".gitignore", "dist/\n.env\n");
  fs.symlinkSync("other/b.ts", path.join(dest, "link.ts"));
  if (cageYaml !== undefined) write(dest, ".cage.yaml", cageYaml);
  git(dest, "add", "-A");
  git(dest, "commit", "-q", "-m", "base");
  write(dest, "src/billing/.env", `${SECRET}\n`);
  write(dest, "other/b.ts", "b staged\n");
  git(dest, "add", "other/b.ts");
  write(dest, "other/untracked.ts", "draft\n");
  return dest;
}

/** What an agent outside its task area does, plus one legitimate edit inside it. */
const WANDER = [
  "set -e",
  "echo 'export const invoice = 2;' > src/billing/invoice.ts",
  "echo 'export const util = 2;' > src/shared/util.ts",
  "echo evil > other/b.ts",
  "echo evil > other/untracked.ts",
  "echo new > other/new.ts",
  "rm other/del.ts",
  "chmod 644 run.sh",
  "ln -sf other/del.ts link.ts.tmp && mv link.ts.tmp link.ts",
  "echo '{\"a\":1}' > package-lock.json",
  "mkdir -p dist && echo built > dist/app.js",
  "echo TOKEN=agent > src/billing/.env",
].join("\n");

function indexState(dest: string): string {
  return git(dest, "ls-files", "-s");
}

function assertWanderRestored(dest: string, report: Awaited<ReturnType<typeof runCage>>): void {
  assert.equal(report.exit_code, 3);
  assert.deepEqual(
    report.changes.map((c) => [c.path, c.kind, c.rule, c.outcome]),
    [
      ["link.ts", "modified", "out_of_scope", "reverted"],
      ["other/b.ts", "modified", "out_of_scope", "reverted"],
      ["other/del.ts", "deleted", "out_of_scope", "reverted"],
      ["other/new.ts", "added", "out_of_scope", "removed"],
      ["other/untracked.ts", "modified", "out_of_scope", "reverted"],
      ["package-lock.json", "modified", "out_of_scope", "reverted"],
      ["run.sh", "modified", "out_of_scope", "reverted"],
      ["src/billing/.env", "modified", "secrets", "reverted"],
      ["src/shared/util.ts", "modified", "out_of_scope", "reverted"],
    ],
  );
  assert.equal(read(dest, "src/billing/invoice.ts"), "export const invoice = 2;\n", "in-scope edit kept");
  assert.equal(read(dest, "src/shared/util.ts"), "export const util = 1;\n");
  assert.equal(read(dest, "other/b.ts"), "b staged\n", "restored to the working-tree state at start, not HEAD");
  assert.equal(read(dest, "other/untracked.ts"), "draft\n", "untracked, not ignored: restored too");
  assert.equal(read(dest, "other/del.ts"), "keep me\n");
  assert.equal(read(dest, "other/new.ts"), null);
  assert.equal(fs.statSync(path.join(dest, "run.sh")).mode & 0o777, 0o755, "executable bit restored");
  assert.equal(fs.readlinkSync(path.join(dest, "link.ts")), "other/b.ts", "symlink target restored");
  assert.equal(read(dest, "package-lock.json"), "{}\n", "a lockfile outside the scope is restored");
  assert.equal(read(dest, "dist/app.js"), "built\n", "gitignored output outside the scope is not policed");
  assert.equal(read(dest, "src/billing/.env"), `${SECRET}\n`, "built-in rules still apply inside the scope");
}

test("cage scope: .cage.yaml allow_only restores everything git would track outside the scope (MSN-0276 DoD 1, 3, 4, 6)", POSIX_ONLY, async () => {
  const dest = makeRepo("og-cage-scope-yaml-", "allow_only:\n  - src/billing/**\n");
  const index = indexState(dest);
  const report = await runCage({ cwd: dest, command: ["sh", "-c", WANDER] });
  assertWanderRestored(dest, report);
  assert.deepEqual(report.scope, ["src/billing/**"]);
  assert.deepEqual(report.scope_sources, { cage_yaml: ["src/billing/**"], flag: null });
  assert.equal(indexState(dest), index, "the real index is untouched");
  assert.equal(git(dest, "diff", "--cached", "--name-only"), "other/b.ts", "the staged change is still staged");
  assert.ok(!JSON.stringify(report).includes("SECRET-MARKER") && !JSON.stringify(report).includes("evil"), "digest-only");
});

test("cage scope: --allow-only does the same without .cage.yaml; the CLI names the scope (MSN-0276 DoD 2, 5, 6)", POSIX_ONLY, async () => {
  const lib = makeRepo("og-cage-scope-flag-");
  assertWanderRestored(lib, await runCage({ cwd: lib, allowOnly: ["src/billing"], command: ["sh", "-c", WANDER] }));

  const dest = makeRepo("og-cage-scope-cli-");
  const r = spawnSync(process.execPath, [CLI, "cage", "--allow-only", "src/billing", "--json", "--", "sh", "-c", WANDER], {
    cwd: dest,
    encoding: "utf8",
    env: gitChildEnv(),
  });
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /^cage: watching \d+ protected file\(s\) \(scope: src\/billing\)/m);
  const report = JSON.parse(r.stdout) as { scope: string[]; scope_sources: unknown; changes: { rule: string }[] };
  assert.deepEqual(report.scope, ["src/billing"]);
  assert.deepEqual(report.scope_sources, { cage_yaml: null, flag: ["src/billing"] });
  assert.ok(report.changes.some((c) => c.rule === "out_of_scope"));
});

test("cage scope: .cage.yaml and --allow-only intersect, so neither widens the other (MSN-0276 DoD 2, 6)", POSIX_ONLY, async () => {
  const dest = makeRepo("og-cage-scope-both-", "allow_only:\n  - src\n");
  const plan = buildCagePlan(dest, { allowOnly: ["src/billing", "other"] });
  assert.equal(inCageScope(plan, "src/billing/invoice.ts"), true);
  assert.equal(inCageScope(plan, "src/shared/util.ts"), false, "in the config scope, not in the flag scope");
  assert.equal(inCageScope(plan, "other/b.ts"), false, "in the flag scope, not in the config scope");
  assert.equal(inCageScope(plan, ".git/config"), true, "the git dir is git_control's");
  assert.deepEqual(classifyCagePath(plan, "other/b.ts"), { rule: "out_of_scope", mode: "revert", overridden: false });
  assert.deepEqual(classifyCagePath(plan, ".github/workflows/ci.yml"), { rule: "ci_config", mode: "revert", overridden: false });
  assert.equal(classifyCagePath(buildCagePlan(dest, { allowOnly: [] }), "other/b.ts")?.rule, "out_of_scope", "config scope alone");

  const report = await runCage({
    cwd: dest,
    allowOnly: ["src/billing"],
    command: ["sh", "-c", "echo 2 > src/shared/util.ts; echo 2 > src/billing/invoice.ts"],
  });
  assert.deepEqual(report.changes.map((c) => [c.path, c.outcome]), [["src/shared/util.ts", "reverted"]]);
  assert.equal(read(dest, "src/billing/invoice.ts"), "2\n");
});

test("cage scope: invalid allow_only and --allow-only fail closed; outside git a scope exits 2 (MSN-0276 DoD 1, 4, 6)", async () => {
  const bad: [string, RegExp][] = [
    ["allow_only: []\n", /allow_only must be a non-empty list of globs/],
    ["allow_only: src\n", /allow_only must be a non-empty list of globs/],
    ["allow_only:\n  - 42\n", /allow_only\[0\]: expected a root-relative glob/],
    ["allow_only:\n  - /etc\n", /allow_only\[0\]: expected a root-relative glob/],
    ["allow_only:\n  - ../up\n", /allow_only\[0\]: expected a root-relative glob/],
  ];
  for (const [body, pattern] of bad) {
    const dest = makeRepo("og-cage-scope-bad-", body);
    await assert.rejects(
      runCage({ cwd: dest, command: ["sh", "-c", "echo ran > ran.txt"] }),
      (err: Error & { code?: string; exitCode?: number }) => err.code === "GXT_CAGE_CONFIG_INVALID" && err.exitCode === 2 && pattern.test(err.message),
      body,
    );
    assert.equal(read(dest, "ran.txt"), null, `${body}: command must not run`);
  }
  const dest = makeRepo("og-cage-scope-badflag-");
  await assert.rejects(runCage({ cwd: dest, allowOnly: ["../up"], command: ["true"] }), (err: Error & { code?: string }) => err.code === "GXT_CAGE_SCOPE_INVALID");

  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-scope-nogit-"));
  const r = spawnSync(process.execPath, [CLI, "cage", "--allow-only", "src", "--", "sh", "-c", "echo ran > ran.txt"], {
    cwd: plain,
    encoding: "utf8",
    env: gitChildEnv(),
  });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /GXT_CAGE_SCOPE_NOT_GIT/);
  assert.equal(read(plain, "ran.txt"), null);
});

test("cage scope: --allow-override relaxes one out-of-scope path for the run, announced (MSN-0276 DoD 3, 6)", POSIX_ONLY, async () => {
  const dest = makeRepo("og-cage-scope-override-");
  const report = await runCage({
    cwd: dest,
    allowOnly: ["src/billing"],
    allowOverride: ["other/b.ts"],
    command: ["sh", "-c", "echo mine > other/b.ts; echo evil > src/shared/util.ts"],
  });
  assert.deepEqual(report.overrides, ["other/b.ts"]);
  assert.deepEqual(
    report.changes.map((c) => [c.path, c.rule, c.overridden, c.outcome]),
    [
      ["other/b.ts", "out_of_scope", true, "kept"],
      ["src/shared/util.ts", "out_of_scope", false, "reverted"],
    ],
  );
  assert.equal(read(dest, "other/b.ts"), "mine\n");
});

test("cage scope: an in-session allow_only edit does not change the running session's scope (MSN-0276 DoD 1, 6)", POSIX_ONLY, async () => {
  const dest = makeRepo("og-cage-scope-insession-", "allow_only:\n  - src/billing\n");
  const report = await runCage({
    cwd: dest,
    command: ["sh", "-c", "printf 'allow_only:\\n  - other\\n' > .cage.yaml; echo evil > other/b.ts"],
  });
  const byPath = new Map(report.changes.map((c) => [c.path, c]));
  assert.equal(byPath.get(".cage.yaml")?.outcome, "reverted");
  assert.equal(byPath.get("other/b.ts")?.outcome, "reverted");
  assert.equal(read(dest, "other/b.ts"), "b staged\n");
});

test("cage scope: kill -9 recovery restores out-of-scope changes from the journal's scope tree (MSN-0276 DoD 4, 6)", POSIX_ONLY, () => {
  const dest = makeRepo("og-cage-scope-journal-");
  const journalDir = resolveCageJournalDir(dest);
  const snap = { keepBytes: true, maxFileBytes: 5 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024 };
  // A session that journals its baseline and dies without cleaning up: its pid is dead afterwards.
  const lib = path.join(getRepoRoot(), "dist", "packages", "cage", "src");
  const writer = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { writeCageJournal } from ${JSON.stringify(path.join(lib, "cage-journal.js"))};
       import { buildCagePlan } from ${JSON.stringify(path.join(lib, "cage-rules.js"))};
       import { takeCageSnapshot } from ${JSON.stringify(path.join(lib, "cage-snapshot.js"))};
       const [root, dir, snap] = [process.argv[1], process.argv[2], JSON.parse(process.argv[3])];
       const plan = buildCagePlan(root, { allowOnly: ["src/billing"] });
       writeCageJournal(dir, root, takeCageSnapshot(plan, snap), [], { allowOnly: ["src/billing"] });`,
      dest,
      journalDir,
      JSON.stringify(snap),
    ],
    { encoding: "utf8", env: gitChildEnv() },
  );
  assert.equal(writer.status, 0, writer.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(journalDir, "journal.json"), "utf8")) as {
    scope_tree: string;
    allow_only: string[];
    entries: { rel: string }[];
  };
  assert.match(manifest.scope_tree, /^[0-9a-f]{40,64}$/);
  assert.deepEqual(manifest.allow_only, ["src/billing"]);
  assert.ok(!manifest.entries.some((e) => e.rel === "src/shared/util.ts"), "out-of-scope files live in the tree, not the entry list");

  write(dest, "src/shared/util.ts", "tampered\n");
  write(dest, "other/new.ts", "new\n");
  fs.rmSync(path.join(dest, "other/del.ts"));
  write(dest, "src/billing/invoice.ts", "in scope\n");
  const recovery = recoverCageJournal(dest, journalDir, snap);
  assert.ok(recovery);
  assert.deepEqual(
    recovery.restored.map((c) => [c.rel, c.outcome]),
    [
      ["other/del.ts", "reverted"],
      ["other/new.ts", "removed"],
      ["src/shared/util.ts", "reverted"],
    ],
  );
  assert.equal(read(dest, "src/shared/util.ts"), "export const util = 1;\n");
  assert.equal(read(dest, "src/billing/invoice.ts"), "in scope\n");
});

test("cage scope push guard: a push of an out-of-scope path is refused (MSN-0276 DoD 3, 6)", POSIX_ONLY, async () => {
  const dest = makeRepo("og-cage-scope-push-");
  const remote = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-scope-remote-")));
  git(remote, "init", "-q", "--bare", "-b", "main");
  git(dest, "remote", "add", "origin", remote);
  git(dest, "commit", "-q", "-m", "staged");
  git(dest, "push", "-q", "origin", "HEAD:main");
  const g = "git -c user.email=t@example.com -c user.name=t -c commit.gpgsign=false";
  const script = [
    `echo 3 > src/billing/invoice.ts && ${g} commit -qam ok && git push -q origin HEAD:main; echo $? > probe-push-ok`,
    `echo 3 > src/shared/util.ts && ${g} commit -qam wander && git push -q origin HEAD:main; echo $? > probe-push-wander`,
  ].join("\n");
  const report = await runCage({ cwd: dest, watch: false, allowOnly: ["src/billing", "probe-*"], command: ["sh", "-c", script] });
  assert.equal(read(dest, "probe-push-ok")?.trim(), "0");
  assert.notEqual(read(dest, "probe-push-wander")?.trim(), "0");
  assert.equal(report.push_guard.refused_pushes, 1);
  assert.doesNotMatch(git(remote, "log", "--format=%s", "main"), /wander/);
});

class FakeTty extends EventEmitter {
  isTTY = true;
  setRawMode(): this {
    return this;
  }
  resume(): this {
    return this;
  }
  pause(): this {
    return this;
  }
  press(keys: string): void {
    this.emit("data", Buffer.from(keys));
  }
}

async function waitFor(cond: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
}

test("gantry cage watch --allow-only: an out-of-scope change is prompted; reject restores, accept keeps (MSN-0276 DoD 2, 3, 5, 6)", async () => {
  const dest = makeRepo("og-cage-scope-watch-");
  const tty = new FakeTty();
  const said: string[] = [];
  const done = runCageWatch({ cwd: dest, input: tty, allowOnly: ["src/billing"], watchIntervalMs: 30, notify: false, say: (l) => said.push(l), bell: () => undefined });
  assert.ok(said[0]?.includes("(scope: src/billing)"), said[0]);
  write(dest, "src/billing/invoice.ts", "in scope\n");
  write(dest, "src/shared/util.ts", "wander\n");
  await waitFor(() => said.some((l) => /src\/shared\/util\.ts changed \(out_of_scope, modified, sha256 [0-9a-f]{12}\)/.test(l)));
  tty.press("r");
  await waitFor(() => read(dest, "src/shared/util.ts") === "export const util = 1;\n");
  write(dest, "other/b.ts", "accepted\n");
  await waitFor(() => said.some((l) => l.includes("other/b.ts changed (out_of_scope")));
  tty.press("a");
  await waitFor(() => said.some((l) => l === "cage watch: kept other/b.ts"));
  tty.press("\u0003");
  const report = await done;
  assert.deepEqual(report.scope, ["src/billing"]);
  assert.deepEqual(report.decisions.map((d) => [d.path, d.rule, d.outcome]), [
    ["src/shared/util.ts", "out_of_scope", "rejected"],
    ["other/b.ts", "out_of_scope", "accepted"],
  ]);
  assert.equal(read(dest, "other/b.ts"), "accepted\n", "an accepted out-of-scope change survives shutdown");
  assert.equal(read(dest, "src/billing/invoice.ts"), "in scope\n", "in-scope edits are never prompted");
});

test("cage scope: a file hidden by a .gitignore edit is still removed at exit, also with --no-watch (MSN-0276 DoD 3, 6)", POSIX_ONLY, async () => {
  const dest = makeRepo("og-cage-scope-gitignore-");
  const report = await runCage({
    cwd: dest,
    watch: false,
    allowOnly: ["src/billing"],
    command: ["sh", "-c", "echo hidden.ts >> .gitignore; echo evil > hidden.ts"],
  });
  assert.deepEqual(report.changes.map((c) => [c.path, c.outcome]), [
    [".gitignore", "reverted"],
    ["hidden.ts", "removed"],
  ]);
  assert.equal(read(dest, "hidden.ts"), null);
});
