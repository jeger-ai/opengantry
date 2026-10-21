import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getRepoRoot, gitChildEnv } from "#git/git.js";

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

function commit(dest: string, subject: string): string {
  git(dest, "add", "-A");
  git(dest, "commit", "-q", "--allow-empty", "-m", subject);
  return git(dest, "rev-parse", "HEAD");
}

function verify(cwd: string, ...args: string[]): ReturnType<typeof spawnSync> & { stdout: string; stderr: string } {
  return spawnSync(process.execPath, [CLI, "verify", ...args], { cwd, encoding: "utf8", env: gitChildEnv() }) as never;
}

/** A repo whose contract lets the change touch app/ only and runs one check that prints a marker on failure. */
function makeRepo(prefix: string): { dest: string; base: string } {
  const dest = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  git(dest, "init", "-q", "-b", "main");
  write(dest, ".gitignore", "out/\n");
  write(dest, "app/a.py", "a\n");
  write(
    dest,
    "verify.yaml",
    "schema: opengantry.verify.v1\nscope: { allowed_paths: [app] }\nchecks:\n  - { name: marker, run: \"test ! -f app/bad || { echo CHECK-OUTPUT-MARKER; exit 3; }\", expect: exit0 }\n",
  );
  return { dest, base: commit(dest, "base") };
}

test("gantry verify --contract: exit 0 pass, 1 fail; the failing check's output tail on stderr only (MSN-0277 DoD 5, 6)", () => {
  const { dest, base } = makeRepo("og-verify-cli-");
  write(dest, "app/a.py", "b\n");
  commit(dest, "ok");
  const pass = verify(dest, "--contract", "--base", base);
  assert.equal(pass.status, 0, pass.stderr);
  assert.match(pass.stderr, /^verify: pass {4}marker \(exit 0\)$/m);
  assert.match(pass.stderr, /^verify: full run of verify\.yaml \(base\) on [0-9a-f]{12}\.\.\.[0-9a-f]{12}: 1 changed file\(s\), 1 line\(s\) added$/m);
  assert.match(pass.stderr, /^verify: PASS$/m);

  write(dest, "app/bad", "1\n");
  write(dest, "README.md", "x\n");
  commit(dest, "bad");
  const fail = verify(dest, "--contract", "verify.yaml", "--base", base, "--out", "out/result.json");
  assert.equal(fail.status, 1, fail.stderr);
  assert.match(fail.stderr, /^ {8}CHECK-OUTPUT-MARKER$/m, "tail of the failing output, indented");
  assert.match(fail.stderr, /^verify: PROBLEM 1 changed file\(s\) outside allowed_paths: README\.md$/m);
  assert.match(fail.stderr, /^verify: FAIL, 2 problem\(s\)$/m);
  const saved = fs.readFileSync(path.join(dest, "out", "result.json"), "utf8");
  assert.equal((JSON.parse(saved) as { schema: string }).schema, "opengantry.verify-result.v1");
  assert.ok(!saved.includes("CHECK-OUTPUT-MARKER"), "the result file never holds check output");

  const json = verify(dest, "--contract", "--base", base, "--json");
  assert.equal(json.status, 1);
  const r = JSON.parse(json.stdout) as { status: string; checks: { name: string; ok: boolean; reason: string }[] };
  assert.equal(r.status, "fail");
  assert.deepEqual(r.checks.map((c) => [c.name, c.ok, c.reason]), [["marker", false, "exit 3"]]);
  assert.ok(!json.stdout.includes("CHECK-OUTPUT-MARKER"), "digest-only JSON");
  assert.equal(json.stderr.includes("CHECK-OUTPUT-MARKER"), false, "--json prints no progress either");
});

test("gantry verify --contract: --baseline and --check-result through the CLI (MSN-0277 DoD 5)", () => {
  const { dest, base } = makeRepo("og-verify-cli-modes-");
  const b = verify(dest, "--contract", "--base", base, "--baseline");
  assert.equal(b.status, 0, b.stderr);
  assert.match(b.stderr, /^verify: baseline: passes marker \(exit 0\)$/m);
  assert.ok(fs.existsSync(path.join(dest, "verify-baseline.json")));
  fs.rmSync(path.join(dest, "verify-baseline.json"));

  write(dest, "app/a.py", "b\n");
  commit(dest, "work");
  assert.equal(verify(dest, "--contract", "--base", base, "--out", "out/r.json").status, 0);
  const ok = verify(dest, "--contract", "--base", base, "--check-result", "out/r.json");
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stderr, /^verify: VERIFIED$/m);
  write(dest, "app/a.py", "c\n");
  commit(dest, "later");
  const stale = verify(dest, "--contract", "--base", base, "--check-result", "out/r.json", "--json");
  assert.equal(stale.status, 1);
  assert.equal((JSON.parse(stale.stdout) as { status: string }).status, "fail");
});

test("gantry verify --contract: usage and setup errors exit 2; gate.json ignored keys are noted (MSN-0277 DoD 1, 5)", () => {
  const { dest, base } = makeRepo("og-verify-cli-errors-");
  const cases: [string[], RegExp][] = [
    [["--contract", "--base", base, "--format", "html"], /--format must be text, json, sarif or junit \(got html\)/],
    [["--contract", "--base", base, "--baseline", "--format", "sarif"], /--format sarif projects a run's result/],
    [["--contract", "--mission", "x.yaml", "--base", base], /--contract and --mission are separate modes/],
    [["--contract", "--base", base, "--quick", "--worktree"], /choose one of --worktree, --quick/],
    [["--contract", "--base", "no-such-ref"], /GXT_VERIFY_BASE_INVALID/],
    [["--contract", "missing.yaml", "--base", base], /GXT_VERIFY_CONTRACT_INVALID.*cannot read/],
  ];
  for (const [args, pattern] of cases) {
    const r = verify(dest, ...args);
    assert.equal(r.status, 2, `${args.join(" ")}: ${r.stderr}`);
    assert.match(r.stderr, pattern);
  }
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-cli-nogit-"));
  const nogit = verify(plain, "--contract", "--base", "HEAD");
  assert.equal(nogit.status, 2);
  assert.match(nogit.stderr, /GXT_VERIFY_NOT_GIT/);

  const handover = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-cli-handover-"));
  write(handover, "gate.json", JSON.stringify({ schema: "commitly.gate.v1", base, allowed_paths: ["."], forbidden_paths: [], cage_protect: [], checks: [] }));
  const g = verify(dest, "--contract", path.join(handover, "gate.json"));
  assert.equal(g.status, 0, g.stderr);
  assert.match(g.stderr, /^verify: note: cage_protect in .*gate\.json are for the cage and hangar, not verify; ignored$/m);
  assert.match(g.stderr, /\(disk\)/);
});

test("gantry verify --contract --format sarif|junit: the result projected on stdout, the summary on stderr (MSN-0340)", () => {
  const { dest } = makeRepo("og-verify-cli-export-");
  write(dest, "verify.yaml", "schema: opengantry.verify.v1\nscope: { allowed_paths: [app] }\nrules: [{ name: no print, files: ['app/**'], forbid: 'print[(]', why: logging }]\nchecks:\n  - { name: ok, run: 'true', expect: exit0 }\n  - { name: bad, run: 'exit 3', expect: exit0 }\n");
  const contractBase = commit(dest, "contract");
  write(dest, "app/a.py", "x = 1\nprint(1)\n");
  write(dest, "README.md", "x\n");
  commit(dest, "work");

  const sarif = verify(dest, "--contract", "--base", contractBase, "--format", "sarif");
  assert.equal(sarif.status, 1, sarif.stderr);
  assert.match(sarif.stderr, /^verify: FAIL, 3 problem\(s\)$/m, "the human summary stays on stderr");
  const log = JSON.parse(sarif.stdout) as { version: string; runs: { results: { ruleId: string; message: { text: string }; locations: { physicalLocation: { artifactLocation: { uri: string }; region?: { startLine: number } } }[] }[] }[] };
  assert.equal(log.version, "2.1.0");
  assert.deepEqual(
    log.runs[0]!.results.map((r) => [r.ruleId, r.locations[0]!.physicalLocation.artifactLocation.uri, r.locations[0]!.physicalLocation.region?.startLine ?? null, r.message.text]),
    [
      ["verify/outside-allowed-paths", "README.md", null, "changed outside allowed_paths"],
      ["verify/rule", "app/a.py", 2, 'rule "no print" (logging)'],
      ["verify/check", "verify.yaml", null, 'check "bad": exit 3'],
    ],
  );

  const junit = verify(dest, "--contract", "--base", contractBase, "--format", "junit");
  assert.equal(junit.status, 1, junit.stderr);
  assert.match(junit.stdout, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<testsuites name="gantry" tests="5" failures="3">$/m);
  assert.match(junit.stdout, /<testcase classname="gantry\.verify\.contract" name="scope"><failure message="README\.md: outside allowed_paths">/);
  assert.match(junit.stdout, /<testcase classname="gantry\.verify\.contract" name="size"\/>/);
  assert.match(junit.stdout, /name="rule: no print"><failure message="app\/a\.py:2">/);
  assert.match(junit.stdout, /name="check: ok"\/>/);
  assert.match(junit.stdout, /name="check: bad"><failure message="exit 3">/);

  write(dest, "README.md", "y\n");
  const dirty = verify(dest, "--contract", "--base", contractBase, "--format", "junit");
  assert.match(dirty.stdout, /name="uncommitted"><failure message="the tree has uncommitted changes/);
});

test("gantry verify without --contract is mission verify as before (MSN-0277 DoD 5)", () => {
  const { dest } = makeRepo("og-verify-cli-mission-");
  const r = verify(dest, "--mission", "no-such-mission.yaml");
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stderr, /verify contract|--contract/);
});
