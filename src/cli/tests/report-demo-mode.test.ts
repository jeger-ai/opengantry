import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isReportDemoMode,
  applyReportDemoOverview,
  withReportDemoOverlay,
  REL_REPORT_DEMO_FLAG,
} from "../lib/report-demo-mode.js";
import { DEMO_REPO_NAME, DEMO_TIMELINE } from "../lib/report-demo-fixtures.js";
import { projectOverviewViewModel } from "../lib/report-overview-projector.js";
import { buildGxtExtensionMetadata } from "../lib/git-metrics.js";

test("isReportDemoMode: false when flag missing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-demo-off-"));
  assert.equal(isReportDemoMode(root), false);
});

test("applyReportDemoOverview replaces repo and timeline", () => {
  const demo = applyReportDemoOverview({
    repo_name: "my-real-repo",
    schema_version: "0.1.0",
    pinned_mission: ".gitagent/missions/MSN-0999.real.yaml",
    verify_readiness: "blocked",
    readiness_summary: "blocked",
    blockers: ["x"],
    next_step: null,
    metrics: {
      ref: "HEAD",
      missions_completed: 1,
      bypass_count: 0,
      bypass_audit_commits: 0,
      legislative_commits: 0,
      worker_trace_commits: 0,
      turnaround_seconds: { mean: null, median: null, samples: 0 },
      mission_ids: [],
      gxt_extension_metadata: buildGxtExtensionMetadata(),
    },
    verify_glance: { ring_total: 0, ring_pass: 0, ring_fail: 0, ring_abort: 0, last_failure: null },
    timeline: [],
    verify_runs: [],
    last_verify: { outcome: "EMPTY", msn_id: "—", message: "", empty: true, href: "/verify" },
  });
  assert.equal(demo.repo_name, DEMO_REPO_NAME);
  assert.equal(demo.timeline.length, DEMO_TIMELINE.length);
  assert.equal(demo.timeline[0]?.msn_id, "MSN-0042");
});

test("withReportDemoOverlay applies demo when flag set", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-demo-ov-"));
  fs.mkdirSync(path.join(root, ".gitagent", "tmp"), { recursive: true });
  fs.writeFileSync(path.join(root, REL_REPORT_DEMO_FLAG), '{"active":true}\n', "utf8");
  const project = withReportDemoOverlay(projectOverviewViewModel);
  const model = project(root);
  assert.equal(model.repo_name, DEMO_REPO_NAME);
  assert.ok(model.timeline.every((row) => row.msn_id.startsWith("MSN-00")));
});

test("withReportDemoOverlay passes through when flag absent", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-demo-pass-"));
  const project = withReportDemoOverlay(projectOverviewViewModel);
  const model = project(root);
  assert.equal(model.repo_name, path.basename(root));
});
