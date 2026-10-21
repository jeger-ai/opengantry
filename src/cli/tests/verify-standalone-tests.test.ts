import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gitChildEnv } from "#git/git.js";
import { parseVerifyYaml } from "#verify/contract.js";
import { verifyResultSarif } from "#verify/export.js";
import { runVerifyContract } from "#verify/run.js";
import { countTestSignals } from "#verify/test-integrity.js";

function git(dest: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", dest, "-c", "user.email=fixture@example.com", "-c", "user.name=Fixture", "-c", "commit.gpgsign=false", ...args], {
    encoding: "utf8",
    env: gitChildEnv(),
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function write(dest: string, rel: string, body: string): void {
  fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
  fs.writeFileSync(path.join(dest, rel), body);
}

function commit(dest: string): string {
  git(dest, "add", "-A");
  git(dest, "commit", "-q", "--allow-empty", "-m", "c");
  return git(dest, "rev-parse", "HEAD");
}

const CONTRACT = 'schema: opengantry.verify.v1\ntests: { files: ["**/*.test.ts", "tests/**/test_*.py"], allow_reduction: ["src/legacy.test.ts"] }\n';
const JS_TEST = [
  'import { test } from "node:test";',
  'import assert from "node:assert/strict";',
  'test("adds", () => {',
  "  assert.equal(add(1, 2), 3);",
  "  assert.equal(add(2, 2), 4);",
  "  expect(add(0, 0)).toBe(0);",
  "  // expect(add(9, 9)).toBe(18);  a comment is not an assertion",
  "});",
  "",
].join("\n");
const PY_TEST = ["def test_add():", "    assert add(1, 2) == 3", "    assert add(2, 2) == 4", ""].join("\n");

/** A repo whose verify.yaml covers TS and Python tests; each case changes the files and commits. */
function judge(change: (dest: string) => void, contract = CONTRACT): ReturnType<typeof runVerifyContract> {
  const dest = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-tests-")));
  git(dest, "init", "-q", "-b", "main");
  write(dest, "verify.yaml", contract);
  write(dest, "src/add.test.ts", JS_TEST);
  write(dest, "src/legacy.test.ts", JS_TEST);
  write(dest, "tests/test_add.py", PY_TEST);
  const base = commit(dest);
  change(dest);
  commit(dest);
  return runVerifyContract({ cwd: dest, base });
}

test("test integrity: signals are counted on code, not in comments (MSN-0348)", () => {
  assert.deepEqual(countTestSignals(JS_TEST, "js"), { assertions: 3, markers: 0, tautologies: 0, empty_catches: 0 });
  assert.deepEqual(
    countTestSignals('it.skip("x", () => { expect(true).toBe(true); try { f(); } catch {} p.catch(() => {}); });\ntest("y", { only: true }, () => {});\n', "js"),
    { assertions: 1, markers: 2, tautologies: 1, empty_catches: 2 },
  );
  assert.deepEqual(
    countTestSignals('@pytest.mark.skip\ndef test_x():\n    assert True\n    self.assertEqual(a, b)\n    try:\n        f()\n    except ValueError: pass\n# assert 1 == 2\n', "py"),
    { assertions: 2, markers: 1, tautologies: 1, empty_catches: 1 },
  );
});

test("test integrity: fewer assertions, new skip markers, trivially true assertions and empty catches fail; the counts name the file (MSN-0348)", () => {
  const cases: [string, (d: string) => void, RegExp][] = [
    ["fewer", (d) => write(d, "src/add.test.ts", JS_TEST.replace("  assert.equal(add(2, 2), 4);\n", "")), /tests: assertions in the changed test files went down \(3 -> 2: src\/add\.test\.ts 3 -> 2\)/],
    ["skip", (d) => write(d, "src/add.test.ts", JS_TEST.replace('test("adds"', 'test.skip("adds"')), /tests: skip or focus markers were added \(0 -> 1/],
    ["tautology", (d) => write(d, "src/add.test.ts", JS_TEST.replace("expect(add(0, 0)).toBe(0)", "expect(true).toBe(true)")), /tests: trivially true assertions were added/],
    ["catch", (d) => write(d, "src/add.test.ts", JS_TEST.replace("  assert.equal(add(1, 2), 3);", "  try { assert.equal(add(1, 2), 3); } catch {}")), /tests: empty catch or except blocks were added/],
    ["deleted", (d) => fs.rmSync(path.join(d, "src/add.test.ts")), /assertions in the changed test files went down \(3 -> 0: src\/add\.test\.ts 3 -> 0\)/],
    ["py-skip", (d) => write(d, "tests/test_add.py", `import pytest\n@pytest.mark.skip\n${PY_TEST}`), /skip or focus markers were added/],
    ["py-fewer", (d) => write(d, "tests/test_add.py", PY_TEST.replace("    assert add(2, 2) == 4\n", "    pass\n")), /went down \(2 -> 1: tests\/test_add\.py 2 -> 1\)/],
  ];
  for (const [name, change, problem] of cases) {
    const r = judge(change);
    assert.equal(r.status, "fail", name);
    assert.ok(r.problems.some((p) => problem.test(p)), `${name}: ${r.problems.join(" | ")}`);
  }
});

test("test integrity: splitting or moving tests, more assertions, and an allow_reduction file pass (MSN-0348)", () => {
  const split = judge((d) => {
    write(d, "src/add.test.ts", JS_TEST.replace("  assert.equal(add(2, 2), 4);\n", ""));
    write(d, "src/add-more.test.ts", 'test("more", () => { assert.equal(add(2, 2), 4); });\n');
  });
  assert.equal(split.status, "pass", split.problems.join(" | "));
  assert.equal(split.tests?.files.length, 2);
  const legacy = judge((d) => fs.rmSync(path.join(d, "src/legacy.test.ts")));
  assert.equal(legacy.status, "pass", "an approved reduction");
  assert.deepEqual(legacy.tests?.allow_reduction, ["src/legacy.test.ts"]);
  const more = judge((d) => write(d, "tests/test_add.py", `${PY_TEST}    assert add(3, 3) == 6\n`));
  assert.equal(more.status, "pass");
  const unread = judge((d) => write(d, "src/add.test.ts", JS_TEST), 'schema: opengantry.verify.v1\ntests: { files: ["**/*.test.*"] }\n');
  assert.equal(unread.tests?.skipped.length, 0);
  assert.equal(judge(() => undefined, "schema: opengantry.verify.v1\n").tests, null, "no tests section, no tests result");
});

test("test integrity: SARIF names the rule and the file; the contract validates the section (MSN-0348)", () => {
  const r = judge((d) => write(d, "src/add.test.ts", JS_TEST.replace('test("adds"', 'test.only("adds"')));
  const log = verifyResultSarif(r, "4.0.0") as { runs: { results: { ruleId: string; locations: { physicalLocation: { artifactLocation: { uri: string } } }[] }[] }[] };
  assert.deepEqual(log.runs[0]!.results.map((x) => [x.ruleId, x.locations[0]!.physicalLocation.artifactLocation.uri]), [["verify/test-markers", "src/add.test.ts"]]);
  assert.throws(() => parseVerifyYaml("schema: opengantry.verify.v1\ntests: { files: [] }\n"), /tests\.files must list at least one glob/);
  assert.throws(() => parseVerifyYaml("schema: opengantry.verify.v1\ntests: { files: [x], allow: [y] }\n"), /allow/);
});
