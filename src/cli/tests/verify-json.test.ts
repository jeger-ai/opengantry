import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getRepoRoot } from "../lib/git.js";
import { GXT_ERROR } from "../lib/gxt-error-codes.js";
import { handleVerify } from "../lib/mcp-runtime.js";
import { runVerify } from "../commands/verify.js";
import {
  writeMiniGapmanRepo,
  writeMiniGapmanMission,
  gitInitCommit,
} from "./test-fixtures.js";
import { captureConsoleAsync, TEACHER_EMAIL, withTeacherEnv, withTeacherEnvAsync } from "./test-shared.js";
import type { VerifyFailedPayload } from "../lib/verify-result-payload.js";

function parseStdoutJson(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  assert.ok(trimmed.startsWith("{"), `expected JSON object, got: ${trimmed.slice(0, 80)}`);
  assert.ok(!trimmed.includes("LEAKED_GATE_OUTPUT\n{"), "gate stdout must not prefix JSON");
  return JSON.parse(trimmed) as Record<string, unknown>;
}

async function runVerifyJsonInRepo(
  dest: string,
  mission: string,
  extra: { workerLog?: string } = {},
): Promise<{ payload: Record<string, unknown>; stdout: string }> {
  const prevCwd = process.cwd();
  return withTeacherEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      const { output } = await captureConsoleAsync(async () => {
        await runVerify({ mission, workerLog: extra.workerLog, json: true });
      });
      return { payload: parseStdoutJson(output.stdout), stdout: output.stdout.trim() };
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
}

test("runVerify --json: pass emits single flat success document", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-json-pass-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] legislate mission", TEACHER_EMAIL);
  const { payload } = await runVerifyJsonInRepo(dest, ".gitagent/missions/m.yaml", {
    workerLog: "WORKER_LOG.md",
  });
  assert.equal(payload.status, "passed");
  assert.equal(payload.phase, "full");
  assert.equal(payload.exit_code, 0);
  assert.equal(payload.msn_id, "MSN-0999");
});

test("runVerify --json: gate failure includes error_code and fix_hints", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-json-gate-"));
  writeMiniGapmanRepo(dest, ogRoot);
  writeMiniGapmanMission(dest, "MSN-0999", "evidence A", `bash -lc "exit 1"`, "DONE", "m.yaml");
  gitInitCommit(dest, "[MSN-0999] legislate mission", TEACHER_EMAIL);
  const { payload } = await runVerifyJsonInRepo(dest, ".gitagent/missions/m.yaml", {
    workerLog: "WORKER_LOG.md",
  });
  assert.equal(payload.status, "failed");
  assert.equal(payload.phase, "gate");
  assert.equal(payload.error_code, GXT_ERROR.GATE_FAILED);
  assert.ok(Array.isArray(payload.fix_hints));
  assert.ok((payload.fix_hints as string[]).length > 0);
  assert.equal(payload.exit_code, 1);
});

test("runVerify --json: trace failure uses trace error_code family", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-json-trace-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] legislate mission", TEACHER_EMAIL);
  fs.writeFileSync(path.join(dest, "WORKER_LOG.md"), "wrong evidence\n", "utf8");
  const { payload } = await runVerifyJsonInRepo(dest, ".gitagent/missions/m.yaml", {
    workerLog: "WORKER_LOG.md",
  });
  assert.equal(payload.status, "failed");
  assert.equal(payload.phase, "trace");
  assert.equal(typeof payload.error_code, "string");
  assert.match(String(payload.error_code), /^GXT_TRACE_/);
});

test("runVerify --json: git-proof failure exposes top-level error_code", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-json-git-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "chore: init without MSN stamp", TEACHER_EMAIL);
  const { payload } = await runVerifyJsonInRepo(dest, ".gitagent/missions/m.yaml", {
    workerLog: "WORKER_LOG.md",
  });
  assert.equal(payload.status, "failed");
  assert.equal(payload.phase, "git_proof");
  assert.equal(payload.error_code, GXT_ERROR.MISSION_UNSTAMPED);
});

test("runVerify --json: init parse failure uses flat envelope with GXT_PARSE_ERROR", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-json-init-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "chore: init", TEACHER_EMAIL);
  const { payload } = await runVerifyJsonInRepo(dest, ".gitagent/missions/does-not-exist.yaml");
  assert.equal(payload.status, "failed");
  assert.equal(payload.phase, "init");
  assert.equal(payload.error_code, GXT_ERROR.PARSE_ERROR);
  assert.equal(typeof payload.message, "string");
});

test("runVerify --json: stdout purity — gate output only in JSON payload", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-json-leak-"));
  writeMiniGapmanRepo(dest, ogRoot);
  writeMiniGapmanMission(
    dest,
    "MSN-0999",
    "evidence A",
    `bash -lc "echo LEAKED_GATE_OUTPUT; exit 1"`,
    "DONE",
    "m.yaml",
  );
  gitInitCommit(dest, "[MSN-0999] legislate mission", TEACHER_EMAIL);
  const { payload, stdout } = await runVerifyJsonInRepo(dest, ".gitagent/missions/m.yaml", {
    workerLog: "WORKER_LOG.md",
  });
  assert.equal(payload.status, "failed");
  assert.ok(String(payload.stdout).includes("LEAKED_GATE_OUTPUT"));
  assert.ok(!stdout.startsWith("LEAKED_GATE_OUTPUT"));
});

test("runVerify --json gate failure matches handleVerify field subset", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-json-parity-"));
  writeMiniGapmanRepo(dest, ogRoot);
  writeMiniGapmanMission(dest, "MSN-0999", "evidence A", `bash -lc "exit 1"`, "DONE", "m.yaml");
  gitInitCommit(dest, "[MSN-0999] legislate mission", TEACHER_EMAIL);
  const prevCwd = process.cwd();
  await withTeacherEnvAsync(async () => {
    process.chdir(dest);
    try {
      const mcp = handleVerify(".gitagent/missions/m.yaml") as VerifyFailedPayload;
      process.exitCode = undefined;
      const { output } = await captureConsoleAsync(async () => {
        await runVerify({
          mission: ".gitagent/missions/m.yaml",
          workerLog: "WORKER_LOG.md",
          json: true,
        });
      });
      const payload = parseStdoutJson(output.stdout);
      assert.equal(payload.status, mcp.status);
      assert.equal(payload.phase, mcp.phase);
      assert.equal(payload.error_code, mcp.error_code);
      assert.deepEqual(payload.fix_hints, mcp.fix_hints);
      assert.deepEqual(payload.next_actions, mcp.next_actions);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});

test("handleVerify: missing mission uses flat init failure envelope", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-mcp-verify-init-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "chore: init", TEACHER_EMAIL);
  const prevCwd = process.cwd();
  withTeacherEnv(() => {
    process.chdir(dest);
    try {
      const result = handleVerify(".gitagent/missions/missing.yaml") as VerifyFailedPayload;
      assert.equal(result.status, "failed");
      assert.equal(result.phase, "init");
      assert.equal(result.error_code, GXT_ERROR.PARSE_ERROR);
      assert.equal("error" in result, false);
    } finally {
      process.chdir(prevCwd);
    }
  });
});
