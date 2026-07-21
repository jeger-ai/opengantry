import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getRepoRoot } from "../lib/git.js";
import { kpiFindingsToAdvisoryVerifyFindings } from "../lib/kpi-advisory-findings.js";
import { evaluateKpiThresholds } from "../lib/kpi-engine.js";
import type { KpiFinding, KpiReport } from "../lib/types.js";

const repoRoot = getRepoRoot();
const stub = path.join(repoRoot, "examples/performance-judge/perf-judge-stub.mjs");
const fixtures = path.join(repoRoot, "examples/performance-judge/fixtures");

function runStub(fixtureName: string): { findings: KpiFinding[] } {
  const out = execFileSync("node", [stub, path.join(fixtures, fixtureName)], {
    encoding: "utf8",
  });
  return JSON.parse(out) as { findings: KpiFinding[] };
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

test("kpi advisory findings do not affect threshold evaluation", () => {
  const report: KpiReport = {
    msn_id: "MSN-0062",
    generated_at: "2026-01-01T00:00:00.000Z",
    metrics: { "perf_judge::reviewed": 1 },
    findings: [
      {
        id: "PERF-POOLING",
        severity: "error",
        path: "src/x.ts",
        message: "advisory only",
        doc_anchor: "PERFORMANCE.md#connection-pooling",
      },
    ],
    exit_code: 0,
  };
  const failures = evaluateKpiThresholds(report, [
    { metric: "perf_judge::reviewed", op: ">=", value: 1 },
  ]);
  assert.equal(failures.length, 0);
});

test("kpiFindingsToAdvisoryVerifyFindings: maps to verify envelope", () => {
  const rows = kpiFindingsToAdvisoryVerifyFindings([
    {
      id: "PERF-POOLING",
      severity: "warn",
      path: "src/db.ts",
      line: 4,
      message: "pooling violation",
      doc_anchor: "PERFORMANCE.md#connection-pooling",
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.failed_gate, "kpi");
  assert.equal(rows[0]!.severity, "warning");
  assert.equal(rows[0]!.offending_file, "src/db.ts");
  assert.match(rows[0]!.resolution_hint, /PERF-POOLING/);
  assert.match(rows[0]!.resolution_hint, /PERFORMANCE\.md/);
});
