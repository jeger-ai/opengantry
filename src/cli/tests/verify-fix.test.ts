import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getRepoRoot } from "../lib/git.js";
import { LEGISLATE_TRACE_PLACEHOLDER } from "../lib/constants.js";
import { runVerify } from "../commands/verify.js";
import {
  writeMiniGantryRepo,
  writeMiniGantryMission,
  gitInitCommit,
} from "./test-fixtures.js";
import { captureConsoleAsync, PLANNER_EMAIL, withPlannerEnvAsync } from "./test-shared.js";

test("runVerify: --fix --non-interactive emits GXT error code on gate failure", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-fix-"));
  writeMiniGantryRepo(dest, ogRoot);
  writeMiniGantryMission(dest, "MSN-0999", "evidence A", `bash -lc "exit 1"`, "DONE", "m.yaml");
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      const { output } = await captureConsoleAsync(async () => {
        await runVerify({
          mission: ".gitagent/missions/m.yaml",
          executorLog: "EXECUTOR_LOG.md",
          fix: true,
          fixNonInteractive: true,
        });
      });
      const combined = output.stdout + output.stderr;
      assert.equal(process.exitCode, 1);
      assert.match(combined, /GXT_GATE_FAILED/);
      assert.match(combined, /Fix:/);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});

test("runVerify: --fix --non-interactive trace_pending lists executor loop steps", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-fix-pending-"));
  writeMiniGantryRepo(dest, ogRoot);
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, ".gitagent", "missions", "pending.yaml"),
    `msn_id: MSN-0014
skill_key: ui
gate_command: echo OK
gate_success_substring: OK
trace_rows:
  - dod_id: "1"
    trace_quote: ${LEGISLATE_TRACE_PLACEHOLDER}
    anchor: "1"
    status: PENDING
`,
    "utf8",
  );
  gitInitCommit(dest, "[MSN-0014] legislate mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      const { output } = await captureConsoleAsync(async () => {
        await runVerify({
          mission: ".gitagent/missions/pending.yaml",
          fix: true,
          fixNonInteractive: true,
        });
      });
      const combined = output.stdout + output.stderr;
      assert.equal(process.exitCode, 1);
      assert.match(combined, /GXT_TRACE_PENDING/);
      assert.match(combined, /runtime env --mission/);
      assert.match(combined, /set trace row status PASS/);
      assert.match(combined, /echo OK/);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});

test("runVerify: --fix --non-interactive placeholder trace_quote hints mission edit", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-fix-placeholder-"));
  writeMiniGantryRepo(dest, ogRoot);
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, ".gitagent", "missions", "pass-placeholder.yaml"),
    `msn_id: MSN-0014
skill_key: ui
gate_command: echo OK
gate_success_substring: OK
trace_rows:
  - dod_id: "1"
    trace_quote: ${LEGISLATE_TRACE_PLACEHOLDER}
    anchor: "1"
    status: PASS
`,
    "utf8",
  );
  fs.writeFileSync(path.join(dest, "EXECUTOR_LOG.md"), "OK\n", "utf8");
  gitInitCommit(dest, "[MSN-0014] legislate mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      const { output } = await captureConsoleAsync(async () => {
        await runVerify({
          mission: ".gitagent/missions/pass-placeholder.yaml",
          fix: true,
          fixNonInteractive: true,
        });
      });
      const combined = output.stdout + output.stderr;
      assert.equal(process.exitCode, 1);
      assert.match(combined, /GXT_TRACE_MISSING/);
      assert.match(combined, /replace trace_quote placeholder/);
      assert.doesNotMatch(combined, /append verbatim trace_quote to .* from executor flight evidence/);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});

test("runVerify: --fix --non-interactive git-proof hint uses mission MSN", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-fix-msn-"));
  writeMiniGantryRepo(dest, ogRoot);
  writeMiniGantryMission(dest, "MSN-0014", "evidence A", "echo OK", "OK", "m.yaml");
  gitInitCommit(dest, "chore: init repo", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      const { output } = await captureConsoleAsync(async () => {
        await runVerify({
          mission: ".gitagent/missions/m.yaml",
          fix: true,
          fixNonInteractive: true,
        });
      });
      const combined = output.stdout + output.stderr;
      assert.equal(process.exitCode, 1);
      assert.match(combined, /GXT_MISSION_UNSTAMPED/);
      assert.match(combined, /\[MSN-0014\]/);
      assert.doesNotMatch(combined, /\[MSN-NNNN\]/);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});

test("runVerify: --fix --non-interactive --audience executor filters next actions", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-fix-audience-"));
  writeMiniGantryRepo(dest, ogRoot);
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, ".gitagent", "missions", "pending.yaml"),
    `msn_id: MSN-0014
skill_key: ui
gate_command: echo OK
gate_success_substring: OK
trace_rows:
  - dod_id: "1"
    trace_quote: ${LEGISLATE_TRACE_PLACEHOLDER}
    anchor: "1"
    status: PENDING
`,
    "utf8",
  );
  gitInitCommit(dest, "[MSN-0014] legislate mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      const { output } = await captureConsoleAsync(async () => {
        await runVerify({
          mission: ".gitagent/missions/pending.yaml",
          fix: true,
          fixNonInteractive: true,
          audience: "executor",
        });
      });
      const combined = output.stdout + output.stderr;
      assert.equal(process.exitCode, 1);
      assert.match(combined, /Executor next steps:/);
      assert.match(combined, /runtime env --mission/);
      assert.doesNotMatch(combined, /Planner: git commit/);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});
