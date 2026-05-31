import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getRepoRoot } from "../lib/git.js";
import { runStart, runStartOrchestration } from "../lib/start-orchestration.js";
import { handleStartOrchestration } from "../lib/mcp-orchestration.js";
import { writeMiniGapmanRepo, gitInitCommit } from "./test-fixtures.js";
import { TEACHER_EMAIL, withTeacherEnv } from "./test-shared.js";

function withTempRepo(fn: (dest: string) => void): void {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-start-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "chore: init", TEACHER_EMAIL);
  const prevCwd = process.cwd();
  withTeacherEnv(() => {
    process.chdir(dest);
    try {
      fn(dest);
    } finally {
      process.chdir(prevCwd);
    }
  });
}

test("runStartOrchestration: scaffolds mission for gapman skill intent", () => {
  withTempRepo((dest) => {
    const result = runStartOrchestration({
      intent: "fix ui button component",
      msn: "MSN-0100",
      skillKey: "ui",
    });
    assert.equal(result.ok, true);
    assert.ok(result.mission_file_path?.includes("MSN-0100"));
    assert.ok(fs.existsSync(path.join(dest, result.mission_file_path!)));
  });
});

test("runStartOrchestration: --no-write skips mission file", () => {
  withTempRepo((dest) => {
    const missionsBefore = fs.readdirSync(path.join(dest, ".gitagent", "missions"));
    const result = runStartOrchestration({
      intent: "fix ui button component",
      msn: "MSN-0101",
      skillKey: "ui",
      writeMission: false,
      silent: true,
    });
    assert.equal(result.ok, true);
    assert.match(result.mission_file_path ?? "", /MSN-0101/);
    const missionsAfter = fs.readdirSync(path.join(dest, ".gitagent", "missions"));
    assert.deepEqual(missionsAfter, missionsBefore);
  });
});

test("runStart: --json emits a single parseable JSON document", () => {
  withTempRepo(() => {
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (msg?: unknown) => {
      lines.push(String(msg ?? ""));
    };
    try {
      runStart({
        intent: "fix ui button component",
        msn: "MSN-0102",
        skillKey: "ui",
        json: true,
      });
    } finally {
      console.log = origLog;
    }
    assert.equal(lines.length, 1);
    const payload = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.equal(payload.status, "ok");
    assert.equal(payload.triage_action, "DIRECT_EXECUTION");
    assert.equal(payload.msn_id, "MSN-0102");
    assert.ok(typeof payload.triage === "object");
    assert.ok(Array.isArray(payload.next_steps));
  });
});

test("handleStartOrchestration: does not write to stdout", () => {
  withTempRepo(() => {
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (msg?: unknown) => {
      lines.push(String(msg ?? ""));
    };
    try {
      const result = handleStartOrchestration({
        intent: "fix ui button component",
        msn_id: "MSN-0103",
        skill_key: "ui",
      });
      assert.equal(result.status, "ok");
    } finally {
      console.log = origLog;
    }
    assert.equal(lines.length, 0);
  });
});
