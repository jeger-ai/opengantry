import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getRepoRoot } from "../lib/git.js";
import { loadManifest } from "../lib/manifest.js";
import { checkSkillManifestSync } from "../lib/skill-sync.js";
import { formatTriageHuman, triageIntent } from "../lib/triage-logic.js";
import { verifyTraceRows } from "../lib/trace.js";
import { runVerify } from "../commands/verify.js";

test("triage: risk_keyword triggers escalation", () => {
  const root = getRepoRoot();
  const m = loadManifest(root);
  const r = triageIntent("refactor ui-ralph", m);
  assert.equal(r.action, "LEGISLATIVE_ESCALATION");
});

test("formatTriageHuman includes action line", () => {
  const root = getRepoRoot();
  const m = loadManifest(root);
  const r = triageIntent("logic-ralph only", m);
  const text = formatTriageHuman(r);
  assert.match(text, /^Action: DIRECT_EXECUTION/m);
});

test("triage: single skill direct execution", () => {
  const root = getRepoRoot();
  const m = loadManifest(root);
  const r = triageIntent("fix styles in ui-ralph", m);
  assert.equal(r.action, "DIRECT_EXECUTION");
  assert.equal(r.skill_key, "ui-ralph");
});

test("skill sync: manifest keys match skills/*.md", () => {
  const root = getRepoRoot();
  const m = loadManifest(root);
  const s = checkSkillManifestSync(root, m);
  assert.equal(s.ok, true, s.errors.join("\n"));
});

test("verifyTraceRows: anchor line must contain quote", () => {
  const log = "line one\nline two evidence here\n";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-trace-"));
  const p = path.join(dir, "WORKER_LOG.md");
  fs.writeFileSync(p, log, "utf8");
  const fails = verifyTraceRows(p, [
    { dodId: "1", traceQuote: "evidence here", anchor: "2", status: "PASS" },
  ]);
  assert.equal(fails.length, 0);
  const bad = verifyTraceRows(p, [
    { dodId: "1", traceQuote: "evidence here", anchor: "1", status: "PASS" },
  ]);
  assert.ok(bad.length > 0);
});

test("runVerify: fixture pass", () => {
  process.exitCode = undefined;
  const root = getRepoRoot();
  const mission = path.join(root, "test/fixtures/verify-pass/mission.yaml");
  const wl = path.join(root, "test/fixtures/verify-pass/WORKER_LOG.md");
  runVerify({ mission, workerLog: wl });
  assert.equal(process.exitCode, undefined, "exitCode should not be set on success");
});
