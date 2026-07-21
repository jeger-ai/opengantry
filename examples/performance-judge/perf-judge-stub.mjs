#!/usr/bin/env node
/**
 * Deterministic BYO performance judge stub (no network).
 * Usage: node perf-judge-stub.mjs <fixture-path>
 *
 * Scans fixture source for the three hazard classes from ADR-0035 / #62.
 */
import fs from "node:fs";

const fixturePath = process.argv[2];
const metrics = { "perf_judge::reviewed": fixturePath ? 1 : 0 };
const findings = [];

if (fixturePath && fs.existsSync(fixturePath)) {
  const src = fs.readFileSync(fixturePath, "utf8");
  const rel = fixturePath.split("/").pop() ?? fixturePath;

  if (/for\s*\([^)]*\)\s*\{[\s\S]*new\s+DbClient\s*\(/.test(src)) {
    findings.push({
      id: "PERF-POOLING",
      severity: "warn",
      path: rel,
      line: src.split("\n").findIndex((l) => l.includes("new DbClient")) + 1 || 1,
      message: "DbClient instantiated inside loop — use shared pool",
      doc_anchor: "PERFORMANCE.md#connection-pooling",
    });
  }

  if (/async\s+function[\s\S]*readFileSync\s*\(/.test(src)) {
    findings.push({
      id: "PERF-NONBLOCKING",
      severity: "warn",
      path: rel,
      line: src.split("\n").findIndex((l) => l.includes("readFileSync")) + 1 || 1,
      message: "sync readFileSync in async handler — use fs.promises",
      doc_anchor: "PERFORMANCE.md#non-blocking-io",
    });
  }

  if (/function\s+expensive\s*\([^)]*\)\s*\{[\s\S]*return\s+expensive\s*\(/.test(src)) {
    findings.push({
      id: "PERF-MEMOIZATION",
      severity: "warn",
      path: rel,
      line: src.split("\n").findIndex((l) => l.includes("return expensive")) + 1 || 1,
      message: "expensive() recalculated on every call — add memoization",
      doc_anchor: "PERFORMANCE.md#memoization-caching",
    });
  }
}

console.log(JSON.stringify({ metrics, findings, exit_code: 0 }));
