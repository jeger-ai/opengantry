import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gitChildEnv } from "../lib/git/git.js";
import { parseCommitlyGate, parseVerifyYaml } from "../lib/verify-standalone/contract.js";
import { verifyPathMatcher } from "../lib/verify-standalone/diff.js";
import { checkVerifyResult, runVerifyContract, writeVerifyBaseline } from "../lib/verify-standalone/run.js";

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

function commit(dest: string, subject: string): string {
  git(dest, "add", "-A");
  git(dest, "commit", "-q", "--allow-empty", "-m", subject);
  return git(dest, "rev-parse", "HEAD");
}

/** A test runner that knows one legacy failure and fails on a marker file. */
const TESTS_SH = [
  "#!/bin/sh",
  'echo "FAILED tests/test_old.py::test_legacy"',
  '[ -f app/new_bug ] && echo "FAILED tests/test_new.py::test_new"',
  "exit 1",
  "",
].join("\n");

const CONTRACT = [
  "schema: opengantry.verify.v1",
  "scope:",
  "  allowed_paths: [app, tests]",
  "  forbidden_paths: [app/secret]",
  "size:",
  "  max_added_lines: 4",
  '  exclude: ["tests/**"]',
  "rules:",
  '  - { name: routes do not query, files: ["app/api/**/*.py"], forbid: "\\\\.query\\\\(", why: layers }',
  "checks:",
  '  - { name: tests, run: ./tests.sh, expect: exit0, failures: "^FAILED (\\\\S+)" }',
  '  - { name: no TODO, run: "git grep -n TODO -- app", expect: empty }',
  "  - { name: slow suite, run: 'echo full > ran-full', expect: exit0, heavy: true, quick_run: 'echo quick > ran-quick' }",
  "",
].join("\n");

/** A committed base with the contract at the root. Returns the repo and base sha. */
function makeRepo(prefix: string, contract = CONTRACT): { dest: string; base: string } {
  const dest = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  git(dest, "init", "-q", "-b", "main");
  write(dest, "app/api/routes.py", "def ok():\n    pass\n");
  write(dest, "README.md", "fixture\n");
  write(dest, "tests.sh", TESTS_SH, 0o755);
  write(dest, ".gitignore", "ran-*\nverify-baseline.json\n");
  write(dest, "verify.yaml", contract);
  return { dest, base: commit(dest, "base") };
}

test("verify contract: verify.yaml is strict; invalid input fails closed with GXT_VERIFY_CONTRACT_INVALID (MSN-0277 DoD 1)", () => {
  const bad: [string, RegExp][] = [
    ["schema: other\n", /schema must be opengantry\.verify\.v1/],
    ["schema: opengantry.verify.v1\nextra: 1\n", /unknown key "extra"/],
    ["schema: opengantry.verify.v1\nscope: { allowed: [a] }\n", /scope: unknown key "allowed"/],
    ["schema: opengantry.verify.v1\nsize: { max_added_lines: -1 }\n", /non-negative integer/],
    ["schema: opengantry.verify.v1\nrules: [{ name: r, files: [a], forbid: '(' }]\n", /not a valid regular expression/],
    ["schema: opengantry.verify.v1\nrules: [{ name: r, files: [], forbid: x }]\n", /files must list at least one glob/],
    ["schema: opengantry.verify.v1\nchecks: [{ name: c, run: x, expect: maybe }]\n", /expect must be exit0 or empty/],
    ["schema: opengantry.verify.v1\nchecks: [{ name: c, run: x, expect: exit0 }, { name: c, run: y, expect: exit0 }]\n", /duplicate name "c"/],
    ["schema: opengantry.verify.v1\nchecks: [{ name: c, run: x, expect: exit0, heavy: yes }]\n", /heavy must be true or false/],
    ["schema: opengantry.verify.v1\nbase: &a main\nscope: { allowed_paths: [*a] }\n", /invalid YAML/],
  ];
  for (const [text, pattern] of bad) {
    assert.throws(() => parseVerifyYaml(text), (e: Error & { code?: string; exitCode?: number }) => e.code === "GXT_VERIFY_CONTRACT_INVALID" && e.exitCode === 2 && pattern.test(e.message), text);
  }
  const c = parseVerifyYaml(CONTRACT);
  assert.deepEqual(c.allowedPaths, ["app", "tests"]);
  assert.equal(c.checks[2]!.quickRun, "echo quick > ran-quick");
  assert.equal(c.rules[0]!.why, "layers");
});

test("verify contract: COMMITLY gate.json (commitly.gate.v1) maps field for field; cage_protect and part are ignored (MSN-0277 DoD 1)", () => {
  const gate = parseCommitlyGate(
    JSON.stringify({
      schema: "commitly.gate.v1",
      base: "abc123",
      allowed_paths: ["server/ai"],
      forbidden_paths: [],
      max_added_lines: 400,
      size_exclude: ["**/tests/**"],
      cage_protect: [{ path: "docker-compose.yml" }],
      rules: [{ name: "no http", approach: "web layers", files: ["client/**/*.ts"], forbid: "\\bHttpClient\\b" }],
      checks: [{ name: "C2", part: "backend", heavy: true, cmd: "make test", self_check: null, failures: "^FAIL: (.+)$", expect: "exit0" }],
    }),
  );
  assert.equal(gate.format, "commitly_gate");
  assert.equal(gate.base, "abc123");
  assert.deepEqual(gate.allowedPaths, ["server/ai"]);
  assert.equal(gate.maxAddedLines, 400);
  assert.deepEqual(gate.rules[0], { name: "no http", files: ["client/**/*.ts"], forbid: "\\bHttpClient\\b", why: "web layers" });
  assert.deepEqual(gate.checks[0], { name: "C2", run: "make test", expect: "exit0", heavy: true, quickRun: null, failures: "^FAIL: (.+)$" });
  assert.deepEqual(gate.ignored, ["cage_protect", "checks[].part"]);
  assert.throws(() => parseCommitlyGate('{"schema":"commitly.gate.v1","extra":1}'), /unknown key "extra"/);
});

test("verify paths: no wildcard is the path or a folder above it; *, ** and ? are globs (MSN-0277 DoD 3)", () => {
  const m = (p: string, f: string): boolean => verifyPathMatcher(p)(f);
  assert.equal(m("app", "app/api/x.py"), true);
  assert.equal(m("app/", "app"), true);
  assert.equal(m("app", "apple/x"), false);
  assert.equal(m(".", "anything/at/all"), true);
  assert.equal(m("app/*.py", "app/x.py"), true);
  assert.equal(m("app/*.py", "app/api/x.py"), false);
  assert.equal(m("app/**/*.py", "app/x.py"), true);
  assert.equal(m("**/tests/**", "a/b/tests/c/d.py"), true);
  assert.equal(m("v?.txt", "v1.txt"), true);
});

test("verify run: scope, forbidden paths, size budget and rules each fail with what they found (MSN-0277 DoD 3, 6)", () => {
  const { dest, base } = makeRepo("og-verify-run-");
  write(dest, "app/api/routes.py", "def ok():\n    pass\ndef bad():\n    db.query(x)\n    return 1\n");
  write(dest, "app/secret/key.txt", "k\n");
  write(dest, "README.md", "changed\n");
  write(dest, "tests/test_a.py", "a\nb\nc\nd\ne\nf\n");
  commit(dest, "work");
  const r = runVerifyContract({ cwd: dest, base });
  assert.equal(r.status, "fail");
  assert.equal(r.mode, "full");
  assert.equal(r.base, base);
  assert.deepEqual(r.paths.outside, ["README.md"]);
  assert.deepEqual(r.paths.forbidden, ["app/secret/key.txt"]);
  assert.deepEqual(r.size, { added: 5, max: 4, files: 3 }, "tests/** excluded; README 1 + routes 3 + key 1");
  assert.deepEqual(r.rules, [{ name: "routes do not query", why: "layers", violations: [{ file: "app/api/routes.py", line: 4 }] }]);
  assert.equal(r.problems.length, 5, r.problems.join("\n"));
  assert.ok(r.problems.some((p) => p.startsWith("check \"tests\"")), "no baseline: the legacy failure fails the check");
  const json = JSON.stringify(r);
  assert.ok(!json.includes("db.query") && !json.includes("FAILED tests/"), "digest-only: no added-line text, no check output");
});

test("verify trust: a tracked contract is read from the base commit, so a change cannot weaken it (MSN-0277 DoD 2)", () => {
  const { dest, base } = makeRepo("og-verify-trust-");
  write(dest, "README.md", "changed\n");
  write(dest, "verify.yaml", "schema: opengantry.verify.v1\n");
  commit(dest, "weaken the contract and wander");
  const r = runVerifyContract({ cwd: dest, base, mode: "quick" });
  assert.equal(r.contract.source, "base");
  assert.equal(r.contract.path, "verify.yaml");
  assert.ok(r.paths.outside.includes("README.md"), "the base contract's allowed_paths still apply");

  const fresh = makeRepo("og-verify-trust-new-", "");
  fs.rmSync(path.join(fresh.dest, "verify.yaml"));
  const freshBase = commit(fresh.dest, "no contract at base");
  write(fresh.dest, "verify.yaml", "schema: opengantry.verify.v1\n");
  commit(fresh.dest, "add a contract");
  assert.throws(() => runVerifyContract({ cwd: fresh.dest, base: freshBase }), (e: Error & { code?: string }) => e.code === "GXT_VERIFY_CONTRACT_NOT_AT_BASE");

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-handover-"));
  write(outside, "gate.json", JSON.stringify({ schema: "commitly.gate.v1", base, allowed_paths: ["."], forbidden_paths: [], checks: [] }));
  const h = runVerifyContract({ cwd: dest, contract: path.join(outside, "gate.json") });
  assert.equal(h.contract.source, "disk");
  assert.equal(h.contract.format, "commitly_gate");
  assert.equal(h.status, "pass", h.problems.join("\n"));

  assert.throws(() => runVerifyContract({ cwd: dest }), (e: Error & { code?: string }) => e.code === "GXT_VERIFY_BASE_REQUIRED");
  // A branch that sets base: HEAD in its tracked contract does not get to pick the commit its contract comes from.
  write(dest, "verify.yaml", `${CONTRACT}base: HEAD\n`);
  commit(dest, "pick my own base");
  assert.throws(() => runVerifyContract({ cwd: dest }), (e: Error & { code?: string }) => e.code === "GXT_VERIFY_BASE_REQUIRED");
  const noBase = path.join(outside, "nobase.json");
  write(outside, "nobase.json", JSON.stringify({ schema: "commitly.gate.v1", allowed_paths: ["."], forbidden_paths: [], checks: [] }));
  assert.throws(() => runVerifyContract({ cwd: dest, contract: noBase }), (e: Error & { code?: string }) => e.code === "GXT_VERIFY_BASE_MISSING");
  assert.throws(() => runVerifyContract({ cwd: dest, base: "no-such-ref" }), (e: Error & { code?: string }) => e.code === "GXT_VERIFY_BASE_INVALID");
});

test("verify checks: expect empty, heavy checks in full, quick and worktree modes (MSN-0277 DoD 4, 5)", () => {
  const { dest, base } = makeRepo("og-verify-modes-");
  write(dest, "app/a.py", "# TODO later\n");
  commit(dest, "todo");
  const full = runVerifyContract({ cwd: dest, base });
  const byName = new Map(full.checks.map((c) => [c.name, c]));
  assert.equal(byName.get("no TODO")?.ok, false);
  assert.equal(byName.get("no TODO")?.reason, "prints something");
  assert.equal(fs.readFileSync(path.join(dest, "ran-full"), "utf8"), "full\n");

  const quick = runVerifyContract({ cwd: dest, base, mode: "quick" });
  assert.match(quick.checks.find((c) => c.name === "slow suite")?.skipped ?? "", /--quick/);

  write(dest, "app/a.py", "clean\n");
  write(dest, "app/untracked.py", "u\n");
  const wt = runVerifyContract({ cwd: dest, base, mode: "worktree" });
  assert.equal(wt.mode, "worktree");
  assert.ok(wt.paths.changed.includes("app/untracked.py"), "untracked, not ignored: counted");
  assert.equal(wt.checks.find((c) => c.name === "no TODO")?.ok, true, "the uncommitted fix counts in worktree mode");
  assert.equal(fs.readFileSync(path.join(dest, "ran-quick"), "utf8"), "quick\n", "heavy check runs quick_run");
  assert.ok(!wt.problems.some((p) => p.includes("uncommitted")));
  assert.ok(runVerifyContract({ cwd: dest, base, mode: "quick" }).problems.some((p) => p.includes("uncommitted changes")), "full and quick need a clean tree");
});

test("verify baseline: failures the base already has pass; a new failure fails (MSN-0277 DoD 4, 5)", () => {
  const { dest, base: base0 } = makeRepo("og-verify-baseline-");
  const report = writeVerifyBaseline({ cwd: dest, base: base0 });
  assert.deepEqual(report.checks.tests, { exit: 1, failures: ["tests/test_old.py::test_legacy"] });
  assert.equal(report.file, path.join(dest, "verify-baseline.json"));
  git(dest, "add", "-f", "verify-baseline.json");
  const base = commit(dest, "commit the baseline");

  write(dest, "app/x.py", "x\n");
  commit(dest, "work");
  assert.throws(() => writeVerifyBaseline({ cwd: dest, base }), (e: Error & { code?: string }) => e.code === "GXT_VERIFY_BASELINE_NOT_AT_BASE");
  const known = runVerifyContract({ cwd: dest, base, mode: "quick" }).checks.find((c) => c.name === "tests")!;
  assert.equal(known.ok, true);
  assert.equal(known.reason, "only the 1 failure(s) the baseline lists");

  write(dest, "app/new_bug", "1\n");
  commit(dest, "break something");
  const fresh = runVerifyContract({ cwd: dest, base, mode: "quick" }).checks.find((c) => c.name === "tests")!;
  assert.equal(fresh.ok, false);
  assert.deepEqual(fresh.new_failures, ["tests/test_new.py::test_new"]);

  // The change adds its own failure to the committed baseline: the base commit's baseline still applies.
  const doc = JSON.parse(fs.readFileSync(path.join(dest, "verify-baseline.json"), "utf8")) as { checks: { tests: { failures: string[] } } };
  doc.checks.tests.failures.push("tests/test_new.py::test_new");
  write(dest, "verify-baseline.json", JSON.stringify(doc));
  git(dest, "add", "-f", "verify-baseline.json");
  commit(dest, "accept my own failure");
  assert.equal(runVerifyContract({ cwd: dest, base, mode: "quick" }).checks.find((c) => c.name === "tests")!.ok, false);
});

test("verify baseline: a disk baseline must be valid and written for this contract (MSN-0277 DoD 4)", () => {
  const { dest, base } = makeRepo("og-verify-baseline-disk-");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-handover-"));
  const contract = path.join(dir, "verify.yaml");
  fs.writeFileSync(contract, `${CONTRACT}base: ${base}\n`);
  const report = writeVerifyBaseline({ cwd: dest, contract });
  assert.equal(report.file, path.join(dir, "verify-baseline.json"));
  assert.equal(runVerifyContract({ cwd: dest, contract, mode: "quick" }).checks.find((c) => c.name === "tests")!.ok, true);
  fs.appendFileSync(contract, "# edited\n");
  assert.throws(() => runVerifyContract({ cwd: dest, contract }), (e: Error & { code?: string; exitCode?: number }) => e.code === "GXT_VERIFY_BASELINE_STALE" && e.exitCode === 2);
  fs.writeFileSync(report.file, "{oops");
  assert.throws(() => runVerifyContract({ cwd: dest, contract }), (e: Error & { code?: string }) => e.code === "GXT_VERIFY_BASELINE_INVALID");
});

test("verify paths: unusual file names and an added line starting with ++ are judged, not skipped (MSN-0277 DoD 3)", () => {
  const { dest, base } = makeRepo("og-verify-quoted-");
  write(dest, "app/secret/\u00e4 \"q\".txt", "k\n");
  write(dest, "app/api/r\u00f6utes.py", "++ x\ndb.query(1)\n");
  commit(dest, "odd names");
  const r = runVerifyContract({ cwd: dest, base, mode: "quick" });
  assert.deepEqual(r.paths.forbidden, ["app/secret/\u00e4 \"q\".txt"]);
  assert.equal(r.size.added, 3, "both files' lines count");
  assert.deepEqual(r.rules[0]!.violations, [{ file: "app/api/r\u00f6utes.py", line: 2 }]);
  fs.mkdirSync(path.join(dest, "app", "sub"), { recursive: true });
  assert.equal(runVerifyContract({ cwd: path.join(dest, "app", "sub"), base, mode: "quick" }).contract.path, "verify.yaml", "the default contract is at the root");
});

test("verify --check-result: only a passing full run for this HEAD and this contract on a clean tree verifies (MSN-0277 DoD 5)", () => {
  const { dest, base } = makeRepo("og-verify-result-", "schema: opengantry.verify.v1\nscope: { allowed_paths: [app] }\nchecks: [{ name: ok, run: 'true', expect: exit0 }]\n");
  write(dest, "app/x.py", "x\n");
  commit(dest, "work");
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-out-")), "result.json");
  const save = (r: unknown): void => fs.writeFileSync(out, JSON.stringify(r));
  save(runVerifyContract({ cwd: dest, base }));
  assert.deepEqual(checkVerifyResult(out, { cwd: dest, base }), { ok: true, problems: [], signer: null });
  assert.match(checkVerifyResult(out, { cwd: dest, base: "HEAD" }).problems.join(), /the result was measured from [0-9a-f]{12}, the base is/);

  save(runVerifyContract({ cwd: dest, base, mode: "quick" }));
  assert.match(checkVerifyResult(out, { cwd: dest, base }).problems.join(), /a quick run, not a full run/);

  save(runVerifyContract({ cwd: dest, base }));
  write(dest, "app/y.py", "y\n");
  commit(dest, "later");
  assert.match(checkVerifyResult(out, { cwd: dest, base }).problems.join(), /the result is for [0-9a-f]{12}, HEAD is/);

  const contract = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-c-")), "verify.yaml");
  fs.writeFileSync(contract, `schema: opengantry.verify.v1\nbase: ${base}\n`);
  save(runVerifyContract({ cwd: dest, contract }));
  fs.appendFileSync(contract, "scope: { allowed_paths: [app] }\n");
  assert.match(checkVerifyResult(out, { cwd: dest, contract }).problems.join(), /the contract changed after the result was written/);
});
