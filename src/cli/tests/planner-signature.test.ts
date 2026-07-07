import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { assertPlannerMissionProof } from "../lib/git-proof.js";
import { GXT_ERROR } from "../lib/gxt-error-codes.js";
import { isGoodGitSignatureStatus } from "../lib/planner-signature.js";
import { resolvePlannerSignatureTier, loadGxtConfig } from "../lib/gxt-config.js";
import { GapmanUserError } from "../lib/errors.js";
import { writeMiniGapmanRepo, gitInitCommit } from "./test-fixtures.js";
import { getRepoRoot } from "../lib/git.js";
import { PLANNER_EMAIL, withPlannerEnv } from "./test-shared.js";

test("planner-signature: G and U are good", () => {
  assert.equal(isGoodGitSignatureStatus("G"), true);
  assert.equal(isGoodGitSignatureStatus("U"), true);
  assert.equal(isGoodGitSignatureStatus("N"), false);
});

test("gxt-config: invalid planner_signature tier defaults to off", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-gxt-config-"));
  fs.mkdirSync(path.join(dest, ".gitagent"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, ".gitagent/config.json"),
    JSON.stringify({ planner_signature: "bogus" }),
    "utf8",
  );
  assert.equal(resolvePlannerSignatureTier(loadGxtConfig(dest)), "off");
});

test("git-proof: planner_signature off passes unsigned stamp", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-gitpf-sig-off-"));
  writeMiniGapmanRepo(dest, ogRoot);
  withPlannerEnv(() => {
    gitInitCommit(dest, "[MSN-0999] legislate", PLANNER_EMAIL);
    const missionAbs = path.join(dest, ".gitagent/missions/m.yaml");
    assert.equal(assertPlannerMissionProof(dest, missionAbs), "MSN-0999");
  });
});

test("git-proof: planner_signature require fails unsigned stamp", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-gitpf-sig-req-"));
  writeMiniGapmanRepo(dest, ogRoot);
  fs.mkdirSync(path.join(dest, ".gitagent"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, ".gitagent/config.json"),
    JSON.stringify({ planner_signature: "require" }),
    "utf8",
  );
  withPlannerEnv(() => {
    gitInitCommit(dest, "[MSN-0999] legislate", PLANNER_EMAIL);
    const missionAbs = path.join(dest, ".gitagent/missions/m.yaml");
    assert.throws(
      () => assertPlannerMissionProof(dest, missionAbs),
      (e: unknown) => {
        assert.ok(e instanceof GapmanUserError);
        assert.match(String(e.message), /PLANNER_STAMP_UNSIGNED/);
        assert.equal(e.gxtCode, GXT_ERROR.PLANNER_STAMP_UNSIGNED);
        return true;
      },
    );
  });
});

test("git-proof: planner_signature warn collects warning", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-gitpf-sig-warn-"));
  writeMiniGapmanRepo(dest, ogRoot);
  fs.mkdirSync(path.join(dest, ".gitagent"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, ".gitagent/config.json"),
    JSON.stringify({ planner_signature: "warn" }),
    "utf8",
  );
  withPlannerEnv(() => {
    gitInitCommit(dest, "[MSN-0999] legislate", PLANNER_EMAIL);
    const missionAbs = path.join(dest, ".gitagent/missions/m.yaml");
    const warnings: string[] = [];
    assert.equal(assertPlannerMissionProof(dest, missionAbs, { warnings }), "MSN-0999");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /unsigned/);
  });
});
