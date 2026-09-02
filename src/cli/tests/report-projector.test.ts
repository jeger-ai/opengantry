import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConicGradient,
  buildDonutBuckets,
  buildPhaseBars,
  projectReportViewModel,
} from "../lib/report-projector.js";
import { verifyFinding } from "../lib/verify-finding.js";
import { appendVerifyRunRing } from "../lib/verify-run-ring.js";
import { renderReportHtml } from "../lib/report-template-html.js";
import { jsonScriptIsland } from "../lib/report-template-shared.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function baseReportModel(
  partial: Partial<Parameters<typeof renderReportHtml>[0]> = {},
): Parameters<typeof renderReportHtml>[0] {
  return {
    outcome: "FAIL",
    msn_id: "MSN-0001",
    mission_file_path: "m.yaml",
    error_code: "GXT_GATE_FAILED",
    message: "fail",
    findings_digest: "",
    digest_ring: [],
    ring_highlight: false,
    ring_recurrence_count: 0,
    gate_log_path: "",
    has_log: false,
    log_href: "/log",
    back_href: "/",
    run_id: "",
    written_at: "2026-01-01T00:00:00.000Z",
    phases: [],
    donut: { buckets: { kpi: 0, error: 1, warning: 0 }, conic: "#000 0% 100%" },
    findings: [],
    empty: false,
    ...partial,
  };
}

test("buildDonutBuckets counts KPI exclusively", () => {
  const finding = verifyFinding("kpi", "advisory", {
    offending_file: "x.ts",
    severity: "error",
  });
  const buckets = buildDonutBuckets([finding]);
  assert.equal(buckets.kpi, 1);
  assert.equal(buckets.error, 0);
  assert.equal(buckets.warning, 0);
});

test("buildPhaseBars avoids NaN when all zero", () => {
  const bars = buildPhaseBars([
    { id: "gate", duration_ms: 0, status: "skipped" },
    { id: "trace", duration_ms: 0, status: "skipped" },
  ]);
  assert.equal(bars[0]?.bar_pct, 0);
  assert.equal(bars[1]?.bar_pct, 0);
});

test("buildConicGradient returns muted stop when empty", () => {
  const conic = buildConicGradient({ kpi: 0, error: 0, warning: 0 });
  assert.match(conic, /0% 100%/);
});

test("jsonScriptIsland escapes script-breaking characters", () => {
  const raw = jsonScriptIsland({ evidence: "</script>\u2028\u2029" });
  assert.match(raw, /\\u003c/);
  assert.match(raw, /\\u2028/);
  assert.match(raw, /\\u2029/);
});

test("projectReportViewModel reads latest ring snapshot", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-report-"));
  appendVerifyRunRing(root, {
    schema_version: 1,
    written_at: new Date().toISOString(),
    outcome: "ABORT",
    msn_id: "MSN-0099",
    mission_file_path: ".gitagent/missions/m.yaml",
    error_code: "GXT_FINDINGS_RECURRED",
    message: "recurred",
    findings_digest: "abc123",
    digest_ring: ["abc123", "def456"],
    phases: [{ id: "gate", duration_ms: 50, status: "failed" }],
  });
  const model = projectReportViewModel(root);
  assert.equal(model.outcome, "ABORT");
  assert.equal(model.msn_id, "MSN-0099");
  assert.equal(model.ring_highlight, true);
});

test("renderReportHtml includes guidance strip", () => {
  const html = renderReportHtml(baseReportModel());
  assert.match(html, /How to read this view/);
  assert.match(html, /GXT_FINDINGS_RECURRED/);
  assert.match(html, /Back to Overview/);
  assert.match(html, /status-panel/);
  assert.match(html, /badge--fail/);
});

test("renderReportHtml escapes message XSS", () => {
  const html = renderReportHtml(
    baseReportModel({ message: '<script>alert("x")</script>' }),
  );
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test("renderReportHtml expands findings when requested", () => {
  const html = renderReportHtml(
    baseReportModel({
      findings: [
        {
          failed_gate: "gate",
          rule_id: "import-layer",
          location: "src/billing/webhook-handler.ts",
          resolution_hint: "fix import",
          evidence: "import { x } from '../api/x.js';",
          fingerprint: "fp",
          semantic_fingerprint: "sfp",
        },
      ],
    }),
    { expandFindings: true },
  );
  assert.match(html, /<details class="finding" open>/);
});
