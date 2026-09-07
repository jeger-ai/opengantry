import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getRepoRoot } from "../lib/git.js";
import { GXT_ERROR } from "../lib/gxt-error-codes.js";
import { handleVerify } from "../lib/mcp-runtime.js";
import { clearRemediationSnapshot } from "../lib/context-feed-store.js";
import { runVerify } from "../commands/verify.js";
import {
  writeMiniGantryRepo,
  writeMiniGantryMission,
  gitInitCommit,
} from "./test-fixtures.js";
import { captureConsoleAsync, PLANNER_EMAIL, withPlannerEnvAsync } from "./test-shared.js";
import type { VerifyFailedPayload } from "../lib/verify-payload.js";

function parseStdoutJson(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  assert.ok(trimmed.startsWith("{"), `expected JSON object, got: ${trimmed.slice(0, 80)}`);
  assert.ok(!trimmed.includes("LEAKED_GATE_OUTPUT\n{"), "gate stdout must not prefix JSON");
  return JSON.parse(trimmed) as Record<string, unknown>;
}

async function runVerifyJsonInRepo(
  dest: string,
  mission: string,
  extra: { executorLog?: string } = {},
): Promise<{ payload: Record<string, unknown>; stdout: string }> {
  const prevCwd = process.cwd();
  return withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      const { output } = await captureConsoleAsync(async () => {
        await runVerify({ mission, executorLog: extra.executorLog, json: true });
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
  writeMiniGantryRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const { payload } = await runVerifyJsonInRepo(dest, ".gitagent/missions/m.yaml", {
    executorLog: "EXECUTOR_LOG.md",
  });
  assert.equal(payload.status, "passed");
  assert.equal(payload.phase, "full");
  assert.equal(payload.exit_code, 0);
  assert.equal(payload.msn_id, "MSN-0999");
});

test("runVerify --json: gate failure includes error_code and fix_hints", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-json-gate-"));
  writeMiniGantryRepo(dest, ogRoot);
  writeMiniGantryMission(dest, "MSN-0999", "evidence A", `bash -lc "exit 1"`, "DONE", "m.yaml");
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const { payload } = await runVerifyJsonInRepo(dest, ".gitagent/missions/m.yaml", {
    executorLog: "EXECUTOR_LOG.md",
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
  writeMiniGantryRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  fs.writeFileSync(path.join(dest, "EXECUTOR_LOG.md"), "wrong evidence\n", "utf8");
  const { payload } = await runVerifyJsonInRepo(dest, ".gitagent/missions/m.yaml", {
    executorLog: "EXECUTOR_LOG.md",
  });
  assert.equal(payload.status, "failed");
  assert.equal(payload.phase, "trace");
  assert.equal(typeof payload.error_code, "string");
  assert.match(String(payload.error_code), /^GXT_TRACE_/);
});

test("runVerify --json: git-proof failure exposes top-level error_code", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-json-git-"));
  writeMiniGantryRepo(dest, ogRoot);
  gitInitCommit(dest, "chore: init without MSN stamp", PLANNER_EMAIL);
  const { payload } = await runVerifyJsonInRepo(dest, ".gitagent/missions/m.yaml", {
    executorLog: "EXECUTOR_LOG.md",
  });
  assert.equal(payload.status, "failed");
  assert.equal(payload.phase, "git_proof");
  assert.equal(payload.error_code, GXT_ERROR.MISSION_UNSTAMPED);
});

test("runVerify --json: init parse failure uses flat envelope with GXT_PARSE_ERROR", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-json-init-"));
  writeMiniGantryRepo(dest, ogRoot);
  gitInitCommit(dest, "chore: init", PLANNER_EMAIL);
  const { payload } = await runVerifyJsonInRepo(dest, ".gitagent/missions/does-not-exist.yaml");
  assert.equal(payload.status, "failed");
  assert.equal(payload.phase, "init");
  assert.equal(payload.error_code, GXT_ERROR.PARSE_ERROR);
  assert.equal(typeof payload.message, "string");
});

test("runVerify --json: stdout purity — gate output only in JSON payload", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-json-leak-"));
  writeMiniGantryRepo(dest, ogRoot);
  writeMiniGantryMission(
    dest,
    "MSN-0999",
    "evidence A",
    `bash -lc "echo LEAKED_GATE_OUTPUT; exit 1"`,
    "DONE",
    "m.yaml",
  );
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const { payload, stdout } = await runVerifyJsonInRepo(dest, ".gitagent/missions/m.yaml", {
    executorLog: "EXECUTOR_LOG.md",
  });
  assert.equal(payload.status, "failed");
  assert.ok(String(payload.stdout).includes("LEAKED_GATE_OUTPUT"));
  assert.ok(!stdout.startsWith("LEAKED_GATE_OUTPUT"));
});

test("runVerify --json gate failure matches handleVerify field subset", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-json-parity-"));
  writeMiniGantryRepo(dest, ogRoot);
  writeMiniGantryMission(dest, "MSN-0999", "evidence A", `bash -lc "exit 1"`, "DONE", "m.yaml");
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      const mcp = (await handleVerify(".gitagent/missions/m.yaml")) as VerifyFailedPayload;
      clearRemediationSnapshot(dest);
      process.exitCode = undefined;
      const { output } = await captureConsoleAsync(async () => {
        await runVerify({
          mission: ".gitagent/missions/m.yaml",
          executorLog: "EXECUTOR_LOG.md",
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

test("runVerify --json --fix: rejects with GXT_INVALID_ARGUMENT", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-json-fix-collision-"));
  writeMiniGantryRepo(dest, ogRoot);
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
          json: true,
          fix: true,
        });
      });
      const payload = parseStdoutJson(output.stdout);
      assert.equal(payload.status, "failed");
      assert.equal(payload.phase, "init");
      assert.equal(payload.error_code, GXT_ERROR.INVALID_ARGUMENT);
      assert.equal(payload.exit_code, 2);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});

test("handleVerify: missing mission uses flat init failure envelope", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-mcp-verify-init-"));
  writeMiniGantryRepo(dest, ogRoot);
  gitInitCommit(dest, "chore: init", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      const result = (await handleVerify(".gitagent/missions/missing.yaml")) as VerifyFailedPayload;
      assert.equal(result.status, "failed");
      assert.equal(result.phase, "init");
      assert.equal(result.error_code, GXT_ERROR.PARSE_ERROR);
      assert.equal("error" in result, false);
    } finally {
      process.chdir(prevCwd);
    }
  });
});

test("runVerify --json-out writes parseable JSON to file", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-json-out-"));
  writeMiniGantryRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const out = path.join(dest, "verify-out.json");
  const prevCwd = process.cwd();
  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      await runVerify({
        mission: ".gitagent/missions/m.yaml",
        executorLog: "EXECUTOR_LOG.md",
        jsonOut: out,
      });
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
  const payload = JSON.parse(fs.readFileSync(out, "utf8")) as Record<string, unknown>;
  assert.equal(typeof payload.status, "string");
  assert.ok(payload.status === "passed" || payload.status === "failed");
});

test("runVerify --json: gate_adapter tsc populates line-level findings with a stable digest", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-json-tsc-adapter-"));
  writeMiniGantryRepo(dest, ogRoot);
  fs.mkdirSync(path.join(dest, "src"), { recursive: true });
  fs.writeFileSync(path.join(dest, "src", "a.ts"), "export {};\nlet n: number = 'x';\n", "utf8");
  fs.writeFileSync(
    path.join(dest, "fake-tsc.cjs"),
    "console.log('(node:1) ExperimentalWarning: noise');\n" +
      "console.log(\"src/a.ts(2,5): error TS2322: Type 'string' is not assignable to type 'number'.\");\n" +
      "console.log('Found 1 error in 1 file.');\nprocess.exit(2);\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(dest, ".gitagent", "missions", "m.yaml"),
    [
      "msn_id: MSN-0999",
      "skill_key: ui",
      "gate_command: node fake-tsc.cjs",
      "gate_adapter: tsc",
      "trace_rows:",
      '  - dod_id: "1"',
      '    trace_quote: "evidence A"',
      '    anchor: "1"',
      "    status: PASS",
      "",
    ].join("\n"),
    "utf8",
  );
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);

  const first = await runVerifyJsonInRepo(dest, ".gitagent/missions/m.yaml", { executorLog: "EXECUTOR_LOG.md" });
  clearRemediationSnapshot(dest);
  const second = await runVerifyJsonInRepo(dest, ".gitagent/missions/m.yaml", { executorLog: "EXECUTOR_LOG.md" });

  assert.equal(first.payload.status, "failed");
  assert.equal(first.payload.phase, "gate");
  const findings = first.payload.findings as Array<Record<string, unknown>>;
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.offending_file, "src/a.ts");
  assert.equal(findings[0]!.line, 2);
  assert.equal(findings[0]!.start_column, 5);
  assert.equal(findings[0]!.rule_id, "TS2322");
  assert.equal(findings[0]!.evidence, "n: number = 'x';");
  assert.equal(typeof first.payload.findings_digest, "string");
  assert.equal(first.payload.findings_digest, second.payload.findings_digest);
});
