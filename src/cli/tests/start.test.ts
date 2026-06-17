import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getRepoRoot } from "../lib/git.js";
import { runStart, runStartOrchestration } from "../lib/start-orchestration.js";
import { handleStartOrchestration } from "../lib/mcp-governance.js";
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
      assert.ok(typeof result.triage === "object");
      assert.equal(result.exit_code, 0);
    } finally {
      console.log = origLog;
    }
    assert.equal(lines.length, 0);
  });
});

test("runStartOrchestration: invalid msn fails with exit_code 2", () => {
  withTempRepo(() => {
    const result = runStartOrchestration({
      intent: "fix ui button component",
      msn: "MSN-007",
      skillKey: "ui",
      silent: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.exit_code, 2);
    assert.equal(result.msn_id, null);
  });
});

test("runStartOrchestration: triage escalation without skill-key fails", () => {
  withTempRepo(() => {
    const result = runStartOrchestration({
      intent: "refactor migrate core security",
      msn: "MSN-0104",
      silent: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.triage_action, "LEGISLATIVE_ESCALATION");
    assert.ok(result.next_steps.length > 0);
    assert.equal(result.exit_code, 2);
  });
});

test("runStartOrchestration: duplicate msn without allowDuplicate fails", () => {
  withTempRepo((dest) => {
    const first = runStartOrchestration({
      intent: "fix ui button component",
      msn: "MSN-0105",
      skillKey: "ui",
      silent: true,
    });
    assert.equal(first.ok, true);
    const second = runStartOrchestration({
      intent: "fix ui button component",
      msn: "MSN-0105",
      skillKey: "ui",
      silent: true,
    });
    assert.equal(second.ok, false);
    assert.equal(second.exit_code, 2);
    assert.ok(second.next_steps.some((s) => s.includes("allow-duplicate")));
    assert.ok(fs.existsSync(path.join(dest, first.mission_file_path!)));
  });
});

test("runStart: --json failure emits failed status with triage", () => {
  withTempRepo(() => {
    const lines: string[] = [];
    const origLog = console.log;
    const prevExit = process.exitCode;
    console.log = (msg?: unknown) => {
      lines.push(String(msg ?? ""));
    };
    try {
      process.exitCode = undefined;
      runStart({
        intent: "refactor migrate core security",
        msn: "MSN-0106",
        json: true,
      });
    } finally {
      console.log = origLog;
      process.exitCode = prevExit;
    }
    assert.equal(lines.length, 1);
    const payload = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.equal(payload.status, "failed");
    assert.ok(typeof payload.triage === "object");
    assert.equal(payload.exit_code, 2);
  });
});
