import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DEFAULT_ACTIVE_MISSION } from "#core/constants.js";
import {
  buildMissionResolutionCandidates,
  readActiveMissionPin,
  resolvePinnedMission,
  pinMissionFile,
} from "#missions/missions/resolution.js";

test("buildMissionResolutionCandidates: GANTRY_MISSION is the first env candidate; a legacy prefix is not read", () => {
  const candidates = buildMissionResolutionCandidates("/repo", {
    profile: "full",
    env: {
      GANTRY_MISSION: "gantry.yaml",
      OTHER_MISSION: "legacy.yaml",
    },
  });
  assert.equal(candidates[0], "gantry.yaml");
  assert.ok(!candidates.includes("legacy.yaml"));
});

test("buildMissionResolutionCandidates full profile ordering", () => {
  const repo = "/repo";
  const candidates = buildMissionResolutionCandidates(repo, {
    explicit: "explicit.yaml",
    profile: "full",
    env: {
      GANTRY_MISSION: "gantry.yaml",
      GANTRY_MISSION_FILE: "gxt.yaml",
    },
  });
  assert.deepEqual(candidates.slice(0, 3), ["explicit.yaml", "gantry.yaml", "gxt.yaml"]);
  assert.ok(candidates.includes(DEFAULT_ACTIVE_MISSION));
  assert.ok(candidates.includes(".gitagent/missions/ACTIVE_MISSION.yaml"));
});

test("resolvePinnedMission: status profile uses GXT env and pin", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-mission-res-"));
  fs.mkdirSync(path.join(dest, ".gitagent/missions"), { recursive: true });
  const missionAbs = path.join(dest, ".gitagent/missions/MSN-0001.from-env.yaml");
  fs.writeFileSync(missionAbs, "msn_id: MSN-0001\nskill_key: ui\ngate_command: echo OK\ntrace_rows: []\n", "utf8");

  const prev = process.env.GANTRY_MISSION_FILE;
  process.env.GANTRY_MISSION_FILE = ".gitagent/missions/MSN-0001.from-env.yaml";
  try {
    const resolved = resolvePinnedMission(dest, { profile: "status" });
    assert.equal(resolved, ".gitagent/missions/MSN-0001.from-env.yaml");
  } finally {
    if (prev === undefined) delete process.env.GANTRY_MISSION_FILE;
    else process.env.GANTRY_MISSION_FILE = prev;
  }
});

test("readActiveMissionPin and pinMissionFile", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-mission-pin-"));
  fs.mkdirSync(path.join(dest, ".gitagent/missions"), { recursive: true });
  const missionAbs = path.join(dest, ".gitagent/missions/MSN-0002.pinned.yaml");
  fs.writeFileSync(missionAbs, "msn_id: MSN-0002\nskill_key: ui\ngate_command: echo OK\ntrace_rows: []\n", "utf8");
  pinMissionFile(dest, missionAbs);
  assert.equal(readActiveMissionPin(dest), ".gitagent/missions/MSN-0002.pinned.yaml");
});
