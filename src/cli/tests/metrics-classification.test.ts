import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { getRepoRoot } from "../lib/git.js";
import {
  aggregateFromLogStream,
  clearMetricsDiffCache,
  collectGitMetrics,
  streamLogRecords,
  GXT_METRICS_CLASSIFICATION_MODE,
  GXT_METRICS_EXTENSION_SCHEMA_VERSION,
} from "../lib/git-metrics.js";
import {
  copyMissionSchema,
  writeManifest,
  writeMiniGapmanMission,
  gitCommit,
} from "./test-fixtures.js";
import { PLANNER_EMAIL, OTHER_EMAIL, withPlannerEnv } from "./test-shared.js";

function initMetricsRepo(dest: string, ogRoot: string): void {
  copyMissionSchema(
    path.join(ogRoot, ".gitagent", "planner"),
    path.join(dest, ".gitagent", "planner"),
  );
  writeManifest(dest, {
    ui: { trust_threshold: "Tier-1", tmvc_roots: [], forbidden_zones: [] },
  });
  writeMiniGapmanMission(dest, "MSN-0999", "evidence A", "echo DONE", "DONE", "MSN-0999.yaml");
  execSync("git init", { cwd: dest, stdio: "pipe" });
  execSync(`git config user.email "${PLANNER_EMAIL}"`, { cwd: dest, stdio: "pipe" });
  execSync('git config user.name "Fixture"', { cwd: dest, stdio: "pipe" });
  execSync("git add -A", { cwd: dest, stdio: "pipe" });
  execSync('git commit -m "init"', { cwd: dest, stdio: "pipe" });
}

function aggregateAtHead(dest: string) {
  clearMetricsDiffCache();
  const records = streamLogRecords(dest, "HEAD");
  return aggregateFromLogStream(dest, records);
}

test("collectGitMetrics: includes namespaced gxt_extension_metadata", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-metrics-meta-"));
  initMetricsRepo(dest, ogRoot);

  const report = withPlannerEnv(() => collectGitMetrics(dest, "HEAD"));
  assert.deepEqual(report.gxt_extension_metadata, {
    classification_mode: GXT_METRICS_CLASSIFICATION_MODE,
    schema_version: GXT_METRICS_EXTENSION_SCHEMA_VERSION,
  });
});

test("aggregateFromLogStream: planner mission commit counts legislative", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-metrics-leg-"));
  initMetricsRepo(dest, ogRoot);

  withPlannerEnv(() => {
    const missionPath = path.join(dest, ".gitagent", "missions", "MSN-0999.yaml");
    fs.appendFileSync(missionPath, "# legislated\n");
    gitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
    const stream = aggregateAtHead(dest);
    assert.equal(stream.legislative, 1);
    assert.equal(stream.worker_trace, 0);
  });
});

test("aggregateFromLogStream: EXECUTOR_LOG-only commit counts worker_trace", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-metrics-trace-"));
  initMetricsRepo(dest, ogRoot);

  fs.appendFileSync(path.join(dest, "EXECUTOR_LOG.md"), "executor trace line\n");
  gitCommit(dest, "[MSN-0999] executor trace", OTHER_EMAIL);

  const stream = aggregateAtHead(dest);
  assert.equal(stream.legislative, 0);
  assert.equal(stream.worker_trace, 1);
});

test("aggregateFromLogStream: dual-touch legislative commit does not double-count worker_trace", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-metrics-dual-"));
  initMetricsRepo(dest, ogRoot);

  withPlannerEnv(() => {
    fs.appendFileSync(path.join(dest, "EXECUTOR_LOG.md"), "dual-touch evidence\n");
    const missionPath = path.join(dest, ".gitagent", "missions", "MSN-0999.yaml");
    fs.appendFileSync(missionPath, "# amended\n");
    gitCommit(dest, "[MSN-0999] legislate and trace", PLANNER_EMAIL);

    const stream = aggregateAtHead(dest);
    assert.equal(stream.legislative, 1);
    assert.equal(stream.worker_trace, 0);
    assert.equal(stream.legislative + stream.worker_trace, 1);
  });
});

test("aggregateFromLogStream: missing planner identity yields zero legislative", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-metrics-noteacher-"));
  initMetricsRepo(dest, ogRoot);

  const prev = process.env.GAPMAN_PLANNER_EMAILS;
  delete process.env.GAPMAN_PLANNER_EMAILS;
  try {
    const missionPath = path.join(dest, ".gitagent", "missions", "MSN-0999.yaml");
    fs.appendFileSync(missionPath, "# no planner env\n");
    gitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
    const stream = aggregateAtHead(dest);
    assert.equal(stream.legislative, 0);
    assert.equal(stream.worker_trace, 0);
  } finally {
    if (prev === undefined) delete process.env.GAPMAN_PLANNER_EMAILS;
    else process.env.GAPMAN_PLANNER_EMAILS = prev;
  }
});

test("aggregateFromLogStream: empty planner env entry does not match empty author", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-metrics-empty-"));
  initMetricsRepo(dest, ogRoot);

  const prev = process.env.GAPMAN_PLANNER_EMAILS;
  process.env.GAPMAN_PLANNER_EMAILS = "   ,  ";
  try {
    const missionPath = path.join(dest, ".gitagent", "missions", "MSN-0999.yaml");
    fs.appendFileSync(missionPath, "# empty allowlist\n");
    gitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
    const stream = aggregateAtHead(dest);
    assert.equal(stream.legislative, 0);
  } finally {
    if (prev === undefined) delete process.env.GAPMAN_PLANNER_EMAILS;
    else process.env.GAPMAN_PLANNER_EMAILS = prev;
  }
});

test("aggregateFromLogStream: code-only commit does not affect routing counters", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-metrics-code-"));
  initMetricsRepo(dest, ogRoot);

  fs.mkdirSync(path.join(dest, "src"), { recursive: true });
  fs.writeFileSync(path.join(dest, "src", "noop.ts"), "export const x = 1;\n");
  gitCommit(dest, "chore: unrelated code", OTHER_EMAIL);

  const stream = aggregateAtHead(dest);
  assert.equal(stream.legislative, 0);
  assert.equal(stream.worker_trace, 0);
});
