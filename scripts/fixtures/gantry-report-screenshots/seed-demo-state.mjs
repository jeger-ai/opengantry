#!/usr/bin/env node
/**
 * Seed .gitagent/tmp for gantry report website screenshot capture.
 * Usage: node scripts/fixtures/gantry-report-screenshots/seed-demo-state.mjs <pass|fail|abort|overview|off>
 *
 * Activates report demo mode (fictional acme-payments data, not real repo MSNs).
 * Prereq: npm run build (uses dist/cli/lib/verify-run-ring.js).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendVerifyRunRing } from "../../../dist/cli/lib/verify-run-ring.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const state = process.argv[2]?.trim().toLowerCase();
if (!state || !["pass", "fail", "abort", "overview", "off"].includes(state)) {
  console.error("Usage: seed-demo-state.mjs <pass|fail|abort|overview|off>");
  process.exit(1);
}

const tmpDir = path.join(root, ".gitagent", "tmp");
const runsDir = path.join(tmpDir, "verify-runs");

function setDemoMode(active) {
  fs.mkdirSync(tmpDir, { recursive: true });
  const flagPath = path.join(tmpDir, "report-demo.json");
  if (active) {
    fs.writeFileSync(flagPath, `${JSON.stringify({ active: true }, null, 2)}\n`);
  } else if (fs.existsSync(flagPath)) {
    fs.unlinkSync(flagPath);
  }
}

function clearRunsDir() {
  fs.rmSync(runsDir, { recursive: true, force: true });
}

const gatePhases = [
  { id: "git_proof", duration_ms: 12, status: "passed" },
  { id: "interrogation", duration_ms: 3, status: "passed" },
  { id: "gate", duration_ms: 8420, status: "failed" },
  { id: "defensive", duration_ms: 0, status: "skipped" },
  { id: "kpi", duration_ms: 0, status: "skipped" },
  { id: "trace", duration_ms: 18, status: "skipped" },
];

const passPhases = gatePhases.map((p) =>
  p.id === "gate" ? { ...p, status: "passed" } : p.id === "trace" ? { ...p, status: "passed" } : p,
);

const finding = {
  failed_gate: "gate",
  offending_file: "src/billing/webhook-handler.ts",
  line: 18,
  end_line: 18,
  start_column: 1,
  end_column: 48,
  severity: "error",
  rule_id: "import-layer",
  resolution_hint: "Move HTTP client import out of the domain layer — lib/ must not import from api/",
  evidence: "import { postJson } from '../api/http-client.js';",
  fingerprint: "a1b2c3d4e5f6789012345678901234567890ab",
  semantic_fingerprint: "deadbeefcafebabe0000000000000001",
};

const missions = {
  pass: {
    msn_id: "MSN-0042",
    mission_file_path: ".gitagent/missions/MSN-0042.add-webhook-retry-backoff.yaml",
  },
  fail: {
    msn_id: "MSN-0041",
    mission_file_path: ".gitagent/missions/MSN-0041.fix-import-layer-violation.yaml",
  },
  abort: {
    msn_id: "MSN-0040",
    mission_file_path: ".gitagent/missions/MSN-0040.harden-idempotency-guard.yaml",
  },
  priorPass: {
    msn_id: "MSN-0039",
    mission_file_path: ".gitagent/missions/MSN-0039.add-ledger-reconciliation-hook.yaml",
  },
};

const snapshots = {
  pass: {
    schema_version: 1,
    written_at: "2026-09-02T12:00:00.000Z",
    outcome: "PASS",
    ...missions.pass,
    digest_ring: ["older0", "prior0", "prior1", "prior2"],
    phases: passPhases,
    findings: [],
  },
  fail: {
    schema_version: 1,
    written_at: "2026-09-02T12:05:00.000Z",
    outcome: "FAIL",
    ...missions.fail,
    error_code: "GXT_GATE_FAILED",
    message: "Gate command failed (npm test)",
    findings: [finding],
    findings_digest: "semdeadbeefcafe",
    digest_ring: ["older0", "prior0", "prior1", "prior2"],
    gate_log_path: ".gitagent/tmp/gate-logs/MSN-0041.last.log",
    phases: gatePhases,
  },
  abort: {
    schema_version: 1,
    written_at: "2026-09-02T12:10:00.000Z",
    outcome: "ABORT",
    ...missions.abort,
    error_code: "GXT_FINDINGS_RECURRED",
    message: "Identical semantic findings recurred — stop the repair loop and escalate to Planner.",
    findings: [finding],
    findings_digest: "abc123digest4567890abcdef1234567890ab",
    digest_ring: ["older0", "prior0", "abc123digest4567890abcdef1234567890ab", "prior2"],
    gate_log_path: ".gitagent/tmp/gate-logs/MSN-0040.last.log",
    phases: gatePhases,
  },
};

const gateLog = `=== stdout ===
> acme-payments@1.4.0 test
> npm run build && node --test "dist/**/*.test.js"

ℹ tests 128
ℹ pass 127
ℹ fail 1

✖ failing tests:
✖ import-layer violation in src/billing/webhook-handler.ts
  import { postJson } from '../api/http-client.js';

=== stderr ===
GXT_GATE_FAILED: npm test exited 1
`;

function writeGateLog(msnId) {
  const logDir = path.join(tmpDir, "gate-logs");
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, `${msnId}.last.log`), gateLog, "utf8");
}

function appendSnapshot(snapshot) {
  appendVerifyRunRing(root, snapshot);
}

if (state === "off") {
  setDemoMode(false);
  console.log("demo mode off");
  process.exit(0);
}

setDemoMode(true);

if (state === "overview") {
  clearRunsDir();
  appendSnapshot({
    ...snapshots.pass,
    written_at: "2026-09-02T11:50:00.000Z",
    ...missions.priorPass,
  });
  appendSnapshot(snapshots.abort);
  appendSnapshot(snapshots.fail);
  appendSnapshot(snapshots.pass);
  writeGateLog("MSN-0041");
  writeGateLog("MSN-0040");
  console.log("overview: seeded fictional demo data for screenshot capture");
  process.exit(0);
}

clearRunsDir();
appendSnapshot(snapshots[state]);
if (state === "fail" || state === "abort") {
  writeGateLog(snapshots[state].msn_id);
}

console.log(`Seeded ${state} → verify-runs ring`);
