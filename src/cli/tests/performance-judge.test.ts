import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getRepoRoot } from "#git/git.js";

const repoRoot = getRepoRoot();
const stub = path.join(repoRoot, "examples/performance-judge/perf-judge-stub.mjs");
const fixtures = path.join(repoRoot, "examples/performance-judge/fixtures");

interface PerfFinding {
  id: string;
}

/** Runs the stub as a check command: findings as JSON on stdout, exit 1 when there are any. */
function runStub(fixtureName: string): { findings: PerfFinding[] } {
  const r = spawnSync("node", [stub, path.join(fixtures, fixtureName)], { encoding: "utf8" });
  const out = JSON.parse(r.stdout) as { findings: PerfFinding[] };
  assert.equal(r.status, out.findings.length > 0 ? 1 : 0, "exit 1 exactly when there are findings");
  return out;
}

test("perf-judge stub: dirty pooling emits PERF-POOLING", () => {
  const { findings } = runStub("dirty-pooling.js");
  assert.ok(findings.some((f) => f.id === "PERF-POOLING"));
});

test("perf-judge stub: clean pooling is silent", () => {
  const { findings } = runStub("clean-pooling.js");
  assert.equal(findings.length, 0);
});

test("perf-judge stub: dirty blocking emits PERF-NONBLOCKING", () => {
  const { findings } = runStub("dirty-blocking.js");
  assert.ok(findings.some((f) => f.id === "PERF-NONBLOCKING"));
});

test("perf-judge stub: clean blocking is silent", () => {
  const { findings } = runStub("clean-blocking.js");
  assert.equal(findings.length, 0);
});

test("perf-judge stub: dirty memoization emits PERF-MEMOIZATION", () => {
  const { findings } = runStub("dirty-memoization.js");
  assert.ok(findings.some((f) => f.id === "PERF-MEMOIZATION"));
});

test("perf-judge stub: clean memoization is silent", () => {
  const { findings } = runStub("clean-memoization.js");
  assert.equal(findings.length, 0);
});
