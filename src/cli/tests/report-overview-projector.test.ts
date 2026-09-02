import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRepoRoot } from "../lib/git.js";
import {
  formatVerifyRunDuration,
  formatVerifyRunWhen,
  projectOverviewViewModel,
} from "../lib/report-overview-projector.js";
import { appendVerifyRunRing } from "../lib/verify-run-ring.js";
import { renderOverviewHtml } from "../lib/report-template-overview.js";
import { gitCommit, gitInitCommit, writeMiniGantryRepo } from "./test-fixtures.js";
import { PLANNER_EMAIL, withPlannerEnv } from "./test-shared.js";

test("projectOverviewViewModel: empty tmp has zero missions and no throw", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ov-empty-"));
  const model = projectOverviewViewModel(root);
  assert.equal(model.metrics.missions_completed, 0);
  assert.equal(model.verify_runs.length, 0);
  assert.equal(model.last_verify.href, "/verify");
});

test("projectOverviewViewModel: git repo surfaces missions and last verify", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ov-git-"));
  writeMiniGantryRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  appendVerifyRunRing(dest, {
    schema_version: 1,
    written_at: new Date().toISOString(),
    outcome: "PASS",
    msn_id: "MSN-0999",
    digest_ring: [],
    phases: [{ id: "gate", duration_ms: 12, status: "passed" }],
  });
  const model = withPlannerEnv(() => projectOverviewViewModel(dest));
  assert.ok(model.metrics.missions_completed >= 1);
  assert.ok(model.timeline.some((row) => row.msn_id === "MSN-0999"));
  assert.equal(model.last_verify.outcome, "PASS");
});

test("projectOverviewViewModel: new commit is reflected on next projection", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ov-commit-"));
  writeMiniGantryRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const before = withPlannerEnv(() => projectOverviewViewModel(dest));
  assert.equal(before.metrics.missions_completed, 1);

  writeMiniGantryRepo(dest, ogRoot);
  const missionPath = path.join(dest, ".gitagent", "missions", "MSN-0888.yaml");
  fs.writeFileSync(
    missionPath,
    "msn_id: MSN-0888\nskill_key: ui\ngate_command: echo DONE\ntrace_rows: []\n",
    "utf8",
  );
  gitCommit(dest, "[MSN-0888] legislate second mission", PLANNER_EMAIL);

  const after = withPlannerEnv(() => projectOverviewViewModel(dest));
  assert.ok(after.metrics.missions_completed >= before.metrics.missions_completed);
  assert.ok(after.timeline.some((row) => row.msn_id === "MSN-0888"));
});

test("projectOverviewViewModel: timeline carries latest local verify status badge data", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ov-status-"));
  appendVerifyRunRing(root, {
    schema_version: 1,
    written_at: new Date().toISOString(),
    outcome: "FAIL",
    msn_id: "MSN-0700",
    message: "1 finding",
    findings: [verifyFindingStub()],
    digest_ring: [],
    phases: [],
  });
  const ogRoot = getRepoRoot();
  writeMiniGantryRepo(root, ogRoot);
  gitInitCommit(root, "[MSN-0700] legislate mission", PLANNER_EMAIL);
  const model = withPlannerEnv(() => projectOverviewViewModel(root));
  const row = model.timeline.find((r) => r.msn_id === "MSN-0700");
  assert.equal(row?.verify_status, "FAIL");
  const html = renderOverviewHtml(model);
  assert.match(html, /badge--fail/);
  assert.match(html, /<th>Status<\/th>/);
  assert.match(html, /run-history/);
  assert.match(html, /1 finding/);
  const run = model.verify_runs[0];
  assert.equal(run?.msn_id, "MSN-0700");
  assert.equal(run?.findings_count, 1);
  assert.ok(run?.summary.length > 0);
  assert.equal(model.verify_glance.ring_fail, 1);
  assert.equal(model.verify_glance.last_failure?.msn_id, "MSN-0700");
  assert.match(html, /Last verify/);
  assert.match(html, /Latest failure/);
});

function verifyFindingStub() {
  return {
    failed_gate: "gate" as const,
    offending_file: "a.ts",
    line: 1,
    end_line: 1,
    start_column: 0,
    end_column: 0,
    severity: "error" as const,
    rule_id: "tsc",
    resolution_hint: "fix",
    evidence: "",
    fingerprint: "fp",
    semantic_fingerprint: "sfp",
  };
}

test("formatVerifyRunWhen and formatVerifyRunDuration", () => {
  assert.equal(formatVerifyRunWhen("2026-09-02T12:00:00.000Z"), "2026-09-02 12:00:00 UTC");
  assert.equal(formatVerifyRunDuration(8420), "8.4s");
  assert.equal(formatVerifyRunDuration(450), "450ms");
});
