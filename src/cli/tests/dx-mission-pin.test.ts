import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { resolveMissionArg } from "../flows/mission-arg.js";
import { pinMissionFile, readActiveMissionPin } from "#missions/mission/resolution.js";
import { GantryUserError } from "#core/user-error.js";

function setupRepo(): { root: string; missionRel: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-dx-"));
  const missionRel = ".gitagent/missions/MSN-0999.test.yaml";
  fs.mkdirSync(path.join(root, ".gitagent/missions"), { recursive: true });
  fs.writeFileSync(
    path.join(root, missionRel),
    "msn_id: MSN-0999\nskill_key: ui\ngate_command: echo OK\ntrace_rows: []\n",
    "utf8",
  );
  return { root, missionRel };
}

test("resolveMissionArg: explicit flag wins over pin", () => {
  const { root, missionRel } = setupRepo();
  const otherRel = ".gitagent/missions/MSN-0001.other.yaml";
  fs.writeFileSync(
    path.join(root, otherRel),
    "msn_id: MSN-0001\nskill_key: ui\ngate_command: echo OK\ntrace_rows: []\n",
    "utf8",
  );
  pinMissionFile(root, path.join(root, missionRel));
  const resolved = resolveMissionArg(root, otherRel);
  assert.equal(resolved.source, "flag");
  assert.equal(resolved.missionRel, otherRel);
});

test("resolveMissionArg: pin when flag omitted", () => {
  const { root, missionRel } = setupRepo();
  pinMissionFile(root, path.join(root, missionRel));
  const resolved = resolveMissionArg(root);
  assert.equal(resolved.source, "pin");
  assert.equal(resolved.missionRel, missionRel);
});

test("resolveMissionArg: MISSION_REQUIRED when unset", () => {
  const { root } = setupRepo();
  assert.throws(
    () => resolveMissionArg(root),
    (e: unknown) => e instanceof GantryUserError && e.code === "MISSION_REQUIRED",
  );
});

test("pinMissionFile writes repo-relative path", () => {
  const { root, missionRel } = setupRepo();
  pinMissionFile(root, path.join(root, missionRel));
  assert.equal(readActiveMissionPin(root), missionRel);
});

test("emitPinnedMissionBanner only for pin source", () => {
  const { root, missionRel } = setupRepo();
  assert.equal(resolveMissionArg(root, missionRel).source, "flag");
  pinMissionFile(root, path.join(root, missionRel));
  assert.equal(resolveMissionArg(root).source, "pin");
});
