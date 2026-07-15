import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getRepoRoot } from "../lib/git.js";
import { runStatus } from "../commands/status.js";
import { pinMissionFile } from "../lib/missions/parser.js";
import { writeMiniGantryRepo, gitInitCommit, writeMiniGantryMission } from "./test-fixtures.js";
import { captureConsole, PLANNER_EMAIL, withPlannerEnv } from "./test-shared.js";

test("runStatus: --json includes verify_readiness and pinned_mission", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-status-"));
  writeMiniGantryRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  withPlannerEnv(() => {
    process.chdir(dest);
    try {
      const { output } = captureConsole(() => {
        runStatus({ json: true });
      });
      const payload = JSON.parse(output.stdout) as {
        verify_readiness: string;
        schema_version: string;
        skill_sync_ok: boolean;
        blockers: string[];
        readiness_summary: string;
      };
      assert.equal(typeof payload.verify_readiness, "string");
      assert.equal(typeof payload.schema_version, "string");
      assert.equal(payload.skill_sync_ok, true);
      assert.ok(Array.isArray(payload.blockers));
      assert.equal(typeof payload.readiness_summary, "string");
    } finally {
      process.chdir(prevCwd);
    }
  });
});

test("runStatus: next_step prefers pinned mission over example.verify", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-status-pin-"));
  writeMiniGantryRepo(dest, ogRoot);
  writeMiniGantryMission(dest, "MSN-0999", "evidence A", "echo OK", "OK", "pinned.yaml");
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  pinMissionFile(dest, path.join(dest, ".gitagent/missions/pinned.yaml"));
  const prevCwd = process.cwd();
  withPlannerEnv(() => {
    process.chdir(dest);
    try {
      const { output } = captureConsole(() => {
        runStatus({ json: true });
      });
      const payload = JSON.parse(output.stdout) as { next_step: string; pinned_mission: string };
      assert.match(payload.next_step, /pinned\.yaml/);
      assert.equal(payload.pinned_mission, ".gitagent/missions/pinned.yaml");
    } finally {
      process.chdir(prevCwd);
    }
  });
});

test("runStatus: --json reports needs_mission blockers when unpinned", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-status-needs-"));
  writeMiniGantryRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  withPlannerEnv(() => {
    process.chdir(dest);
    try {
      const { output } = captureConsole(() => {
        runStatus({ json: true });
      });
      const payload = JSON.parse(output.stdout) as {
        verify_readiness: string;
        blockers: string[];
        readiness_summary: string;
      };
      assert.equal(payload.verify_readiness, "needs_mission");
      assert.ok(payload.blockers.some((b) => b.includes("pinned mission")));
      assert.match(payload.readiness_summary, /needs_mission/);
    } finally {
      process.chdir(prevCwd);
    }
  });
});
