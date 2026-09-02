import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRepoRoot } from "../lib/git.js";
import { evaluateVerifyPhases } from "../lib/verify-engine.js";
import { listVerifyRuns, recordVerifyRunBestEffort } from "../lib/verify-run-ring.js";
import { presentHuman } from "../lib/verify-presenters.js";
import { VerifyPhaseClock } from "../lib/verify-phase-clock.js";
import { loadManifest } from "../lib/manifest.js";
import { gitInitCommit, writeMiniGantryRepo } from "./test-fixtures.js";
import { PLANNER_EMAIL, withPlannerEnv } from "./test-shared.js";
import { parseMissionFile } from "../lib/missions/parser.js";

test("VerifyPhaseClock markFailed records failed status", () => {
  const clock = new VerifyPhaseClock();
  clock.timed("gate", () => "ran");
  clock.markFailed("gate");
  clock.markSkipped("defensive");
  const timings = clock.finalize();
  assert.equal(timings.find((p) => p.id === "gate")?.status, "failed");
  assert.equal(timings.find((p) => p.id === "defensive")?.status, "skipped");
});

test("evaluateVerifyPhases marks failed gate phase as failed in timings", () => {
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
  const result = withPlannerEnv(() => evaluateVerifyPhases(dest, mission, { mission: missionRel }, manifest));
  assert.equal(result.ok, false);
  if (result.ok) return;
  const gate = result.phaseTimings.find((p) => p.id === "gate");
  assert.equal(gate?.status, "failed");
  const defensive = result.phaseTimings.find((p) => p.id === "defensive");
  assert.equal(defensive?.status, "skipped");
});

test("recordVerifyRunBestEffort appends ring entry after human present failure", () => {
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
  const result = withPlannerEnv(() => evaluateVerifyPhases(dest, mission, { mission: missionRel }, manifest));
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
});
