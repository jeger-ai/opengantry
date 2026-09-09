import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRepoRoot } from "../lib/git.js";
import { evaluateVerifyPhases } from "../lib/verify-engine.js";
import { listVerifyRuns, recordVerifyRunBestEffort, readLatestVerifyRunSnapshot } from "../lib/verify-run-ring.js";
import { presentHuman } from "../lib/verify-presenters.js";
import { VerifyPhaseClock } from "../lib/verify-phase-clock.js";
import { loadManifest } from "../lib/manifest.js";
import { gitInitCommit, writeMiniGantryRepo } from "./test-fixtures.js";
import { PLANNER_EMAIL, withPlannerEnvAsync } from "./test-shared.js";
import { parseMissionFile } from "../lib/missions/parser.js";
import { buildVerifyResultPayload } from "../lib/verify-payload.js";
import { evaluateGatePhase } from "../lib/verify-phase-steps.js";
import type { GateExecAdapter } from "../lib/verify-options.js";
import { VERIFY_ENVELOPE_SCHEMA_VERSION, verifyFinding } from "../lib/verify-finding.js";

test("VerifyPhaseClock timed records failed status and rethrows", async () => {
  const clock = new VerifyPhaseClock();
  await assert.rejects(
    () =>
      clock.timed("gate", () => {
        throw new Error("sync boom");
      }),
    /sync boom/,
  );
  const timings = clock.finalize();
  assert.equal(timings.find((p) => p.id === "gate")?.status, "failed");
});

test("VerifyPhaseClock timed records failed status and rethrows for async fn", async () => {
  const clock = new VerifyPhaseClock();
  await assert.rejects(
    () =>
      clock.timed("gate", async () => {
        throw new Error("adapter boom");
      }),
    /adapter boom/,
  );
  const timings = clock.finalize();
  assert.equal(timings.find((p) => p.id === "gate")?.status, "failed");
});

test("VerifyPhaseClock markFailed records failed status", async () => {
  const clock = new VerifyPhaseClock();
  await clock.timed("gate", () => "ran");
  clock.markFailed("gate");
  clock.markSkipped("defensive");
  const timings = clock.finalize();
  assert.equal(timings.find((p) => p.id === "gate")?.status, "failed");
  assert.equal(timings.find((p) => p.id === "defensive")?.status, "skipped");
});

test("evaluateVerifyPhases marks failed gate phase as failed in timings", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-phase-clock-"));
  writeMiniGantryRepo(dest, ogRoot);
  const missionRel = ".gitagent/missions/m.yaml";
  const missionPath = path.join(dest, missionRel);
  fs.writeFileSync(
    missionPath,
    [
      "msn_id: MSN-0100",
      "skill_key: gantry",
      "gate_command: \"false\"",
      "gate_success_substring: NEVER_MATCH",
      "trace_rows:",
      "  - dod_id: \"1\"",
      "    trace_quote: evidence",
      "    anchor: \"1\"",
      "    status: PASS",
    ].join("\n"),
    "utf8",
  );
  gitInitCommit(dest, "[MSN-0100] legislate mission", PLANNER_EMAIL);
  const manifest = loadManifest(dest);
  const mission = parseMissionFile(dest, missionRel);
  const result = await withPlannerEnvAsync(async () =>
    evaluateVerifyPhases(dest, mission, { mission: missionRel }, manifest),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  const gate = result.phaseTimings.find((p) => p.id === "gate");
  assert.equal(gate?.status, "failed");
  const defensive = result.phaseTimings.find((p) => p.id === "defensive");
  assert.equal(defensive?.status, "skipped");
});

test("recordVerifyRunBestEffort appends ring entry after human present failure", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ring-record-"));
  writeMiniGantryRepo(dest, ogRoot);
  const missionRel = ".gitagent/missions/m.yaml";
  const missionPath = path.join(dest, missionRel);
  fs.writeFileSync(
    missionPath,
    [
      "msn_id: MSN-0100",
      "skill_key: gantry",
      "gate_command: \"false\"",
      "gate_success_substring: NEVER_MATCH",
      "trace_rows:",
      "  - dod_id: \"1\"",
      "    trace_quote: evidence",
      "    anchor: \"1\"",
      "    status: PASS",
    ].join("\n"),
    "utf8",
  );
  gitInitCommit(dest, "[MSN-0100] legislate mission", PLANNER_EMAIL);
  const manifest = loadManifest(dest);
  const mission = parseMissionFile(dest, missionRel);
  const result = await withPlannerEnvAsync(async () =>
    evaluateVerifyPhases(dest, mission, { mission: missionRel }, manifest),
  );
  assert.equal(result.ok, false);
  const presented = presentHuman(
    {
      root: dest,
      manifest,
      mission,
      resolved: {
        missionRel,
        missionAbs: missionPath,
        source: "flag",
      },
      options: { mission: missionRel },
    },
    result,
  );
  recordVerifyRunBestEffort(dest, result, presented.remediation ?? null);
  assert.equal(listVerifyRuns(dest).length, 1);
  assert.equal(listVerifyRuns(dest)[0]?.outcome, "FAIL");
  const snap = readLatestVerifyRunSnapshot(dest);
  assert.ok(snap?.gate_log_path);
  assert.ok(Array.isArray(snap?.findings));
  assert.ok(Array.isArray(snap?.phases));
  assert.equal(snap?.outcome, "FAIL");
});

test("buildVerifyResultPayload maps adapter rejection to v3 failed envelope", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-adapter-reject-"));
  writeMiniGantryRepo(dest, ogRoot);
  const missionRel = ".gitagent/missions/m.yaml";
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const manifest = loadManifest(dest);
  const mission = parseMissionFile(dest, missionRel);
  const boom: GateExecAdapter = async () => {
    throw new Error("adapter boom");
  };
  const payload = await withPlannerEnvAsync(() =>
    buildVerifyResultPayload(dest, manifest, mission, {
      mission: missionRel,
      gateExecAdapter: boom,
    }),
  );
  assert.equal(payload.status, "failed");
  if (payload.status !== "failed") return;
  assert.equal(payload.envelope_schema_version, VERIFY_ENVELOPE_SCHEMA_VERSION);
  assert.ok(Array.isArray(payload.findings));
  assert.ok(payload.findings.length > 0);
  assert.match(payload.message, /adapter boom/);
});

test("evaluateGatePhase fails when adapter returns findings despite exitCode 0", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-adapter-findings-"));
  writeMiniGantryRepo(dest, ogRoot);
  const missionRel = ".gitagent/missions/m.yaml";
  const mission = parseMissionFile(dest, missionRel);
  const lying: GateExecAdapter = async () => {
    return {
      exitCode: 0,
      adapter_id: "lying",
      findings: [verifyFinding("gate", "policy failed")],
    };
  };
  const outcome = await evaluateGatePhase(
    {
      root: dest,
      manifest: loadManifest(dest),
      mission,
      options: { mission: missionRel, gateExecAdapter: lying },
      executorLogPath: "EXECUTOR_LOG.md",
    },
    mission.gate!,
  );
  assert.equal(outcome.kind, "fail");
  if (outcome.kind !== "fail") return;
  assert.equal(outcome.failure.phase, "gate");
});
