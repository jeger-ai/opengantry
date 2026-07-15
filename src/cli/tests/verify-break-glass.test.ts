import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import { getRepoRoot } from "../lib/git.js";
import { ENV_BYPASS_SECRET, commitHasValidBypassNote } from "../lib/break-glass.js";
import { runVerify } from "../commands/verify.js";
import {
  writeMiniGantryRepo,
  writeBypassAnchor,
  gitInitCommit,
} from "./test-fixtures.js";
import { captureConsoleAsync, PLANNER_EMAIL, withPlannerEnvAsync } from "./test-shared.js";

test("runVerify: break-glass without secret exits 2", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-bypass-fail-"));
  writeMiniGantryRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  const prevSecret = process.env[ENV_BYPASS_SECRET];
  delete process.env[ENV_BYPASS_SECRET];
  try {
    process.chdir(dest);
    process.exitCode = undefined;
    await runVerify({
      mission: ".gitagent/missions/m.yaml",
      executorLog: "EXECUTOR_LOG.md",
      breakGlass: true,
      breakGlassReason: "production outage requires hotfix",
    });
    assert.equal(process.exitCode, 2);
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
    if (prevSecret === undefined) delete process.env[ENV_BYPASS_SECRET];
    else process.env[ENV_BYPASS_SECRET] = prevSecret;
  }
});


test("runVerify: break-glass skips gate requirement on gate-less mission", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-bypass-nogate-"));
  writeMiniGantryRepo(dest, ogRoot);
  const secret = "emergency-bypass-no-gate";
  writeBypassAnchor(dest, secret);
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  const missionRel = ".gitagent/missions/no-gate.md";
  fs.writeFileSync(
    path.join(dest, missionRel),
    `# Mission: MSN-0999

## 3. Deterministic gate

**Success criteria:** 1
`,
    "utf8",
  );
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  const prevSecret = process.env[ENV_BYPASS_SECRET];
  process.env[ENV_BYPASS_SECRET] = secret;
  try {
    process.chdir(dest);
    process.exitCode = undefined;
    await runVerify({
      mission: missionRel,
      executorLog: "EXECUTOR_LOG.md",
      breakGlass: true,
      breakGlassReason: "production outage requires hotfix",
    });
    assert.equal(process.exitCode, undefined);
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
    if (prevSecret === undefined) delete process.env[ENV_BYPASS_SECRET];
    else process.env[ENV_BYPASS_SECRET] = prevSecret;
  }
});


test("runVerify: missing gate prints Fix hint without stack", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-nogate-"));
  writeMiniGantryRepo(dest, ogRoot);
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  const missionRel = ".gitagent/missions/no-gate.md";
  fs.writeFileSync(
    path.join(dest, missionRel),
    `# Mission: MSN-0999

## 3. Deterministic gate

**Success criteria:** 1
`,
    "utf8",
  );
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      const { output } = await captureConsoleAsync(async () => {
        await runVerify({ mission: missionRel, executorLog: "EXECUTOR_LOG.md" });
      });
      const combined = output.stdout + output.stderr;
      assert.equal(process.exitCode, 1);
      assert.match(combined, /MISSION_NO_GATE/);
      assert.match(combined, /Fix:/);
      assert.match(combined, /example\.verify\.yaml/);
      assert.doesNotMatch(combined, /at assertMissionGatePresent/);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});


test("runVerify: break-glass with secret skips gates", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-bypass-ok-"));
  writeMiniGantryRepo(dest, ogRoot);
  const secret = "emergency-bypass-secret-ok";
  writeBypassAnchor(dest, secret);
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  const prevSecret = process.env[ENV_BYPASS_SECRET];
  process.env[ENV_BYPASS_SECRET] = secret;
  try {
    process.chdir(dest);
    process.exitCode = undefined;
    await runVerify({
      mission: ".gitagent/missions/m.yaml",
      executorLog: "EXECUTOR_LOG.md",
      breakGlass: true,
      breakGlassReason: "production outage requires hotfix",
    });
    assert.equal(process.exitCode, undefined);
    const head = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();
    assert.equal(commitHasValidBypassNote(dest, head), true);
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
    if (prevSecret === undefined) delete process.env[ENV_BYPASS_SECRET];
    else process.env[ENV_BYPASS_SECRET] = prevSecret;
  }
});
