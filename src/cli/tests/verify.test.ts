import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import { getRepoRoot } from "../lib/git.js";
import { ENV_BYPASS_SECRET, commitHasValidBypassNote } from "../lib/break-glass.js";
import { LEGISLATE_TRACE_PLACEHOLDER } from "../lib/mission-legislative-stub.js";
import { runVerify } from "../commands/verify.js";
import {
  writeMiniGapmanRepo,
  writeMiniGapmanMission,
  writeBypassAnchor,
  gitInitCommit,
} from "./test-fixtures.js";
import { captureConsole, captureConsoleAsync, TEACHER_EMAIL, withTeacherEnvAsync } from "./test-shared.js";

test("runVerify: passes with Teacher git-proof in mini repo", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] legislate mission", TEACHER_EMAIL);
  const prevCwd = process.cwd();
  await withTeacherEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      await runVerify({ mission: ".gitagent/missions/m.yaml", workerLog: "WORKER_LOG.md" });
      assert.equal(process.exitCode, undefined, "exitCode should not be set on success");
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});


test("runVerify: gate failure sets exit code 1", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-gate-"));
  writeMiniGapmanRepo(dest, ogRoot);
  writeMiniGapmanMission(dest, "MSN-0999", "evidence A", `bash -lc "exit 1"`, "DONE", "m.yaml");
  gitInitCommit(dest, "[MSN-0999] legislate mission", TEACHER_EMAIL);
  const prevCwd = process.cwd();
  await withTeacherEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      await runVerify({ mission: ".gitagent/missions/m.yaml", workerLog: "WORKER_LOG.md" });
      assert.equal(process.exitCode, 1);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});


test("runVerify: trace mapping failure sets exit code 1", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-trace-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] legislate mission", TEACHER_EMAIL);
  fs.writeFileSync(path.join(dest, "WORKER_LOG.md"), "wrong evidence\n", "utf8");
  const prevCwd = process.cwd();
  await withTeacherEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      await runVerify({ mission: ".gitagent/missions/m.yaml", workerLog: "WORKER_LOG.md" });
      assert.equal(process.exitCode, 1);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});


test("runVerify: break-glass without secret exits 2", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-bypass-fail-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] legislate mission", TEACHER_EMAIL);
  const prevCwd = process.cwd();
  const prevSecret = process.env[ENV_BYPASS_SECRET];
  delete process.env[ENV_BYPASS_SECRET];
  try {
    process.chdir(dest);
    process.exitCode = undefined;
    await runVerify({
      mission: ".gitagent/missions/m.yaml",
      workerLog: "WORKER_LOG.md",
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
  writeMiniGapmanRepo(dest, ogRoot);
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
  gitInitCommit(dest, "[MSN-0999] legislate mission", TEACHER_EMAIL);
  const prevCwd = process.cwd();
  const prevSecret = process.env[ENV_BYPASS_SECRET];
  process.env[ENV_BYPASS_SECRET] = secret;
  try {
    process.chdir(dest);
    process.exitCode = undefined;
    await runVerify({
      mission: missionRel,
      workerLog: "WORKER_LOG.md",
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
  writeMiniGapmanRepo(dest, ogRoot);
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
  gitInitCommit(dest, "[MSN-0999] legislate mission", TEACHER_EMAIL);
  const prevCwd = process.cwd();
  await withTeacherEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      const { output } = await captureConsoleAsync(async () => {
        await runVerify({ mission: missionRel, workerLog: "WORKER_LOG.md" });
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
  writeMiniGapmanRepo(dest, ogRoot);
  const secret = "emergency-bypass-secret-ok";
  writeBypassAnchor(dest, secret);
  gitInitCommit(dest, "[MSN-0999] legislate mission", TEACHER_EMAIL);
  const prevCwd = process.cwd();
  const prevSecret = process.env[ENV_BYPASS_SECRET];
  process.env[ENV_BYPASS_SECRET] = secret;
  try {
    process.chdir(dest);
    process.exitCode = undefined;
    await runVerify({
      mission: ".gitagent/missions/m.yaml",
      workerLog: "WORKER_LOG.md",
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

test("runVerify: --pre-push passes legislative stub after git-proof", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-pre-push-stub-"));
  writeMiniGapmanRepo(dest, ogRoot);
  writeMiniGapmanMission(dest, "MSN-0999", LEGISLATE_TRACE_PLACEHOLDER, "echo OK", "OK", "stub.yaml");
  gitInitCommit(dest, "[MSN-0999] legislate mission", TEACHER_EMAIL);
  const prevCwd = process.cwd();
  await withTeacherEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      const { output } = await captureConsoleAsync(async () => {
        await runVerify({ mission: ".gitagent/missions/stub.yaml", prePush: true });
      });
      assert.equal(process.exitCode, undefined);
      assert.match(output.stdout, /legislative stub OK/);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});

test("runVerify: --pre-push fails unlegislated stub with NO_MSN_COMMITS", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-pre-push-nostamp-"));
  writeMiniGapmanRepo(dest, ogRoot);
  writeMiniGapmanMission(dest, "MSN-0999", LEGISLATE_TRACE_PLACEHOLDER, "echo OK", "OK", "stub.yaml");
  gitInitCommit(dest, "chore: add stub without teacher stamp", TEACHER_EMAIL);
  const prevCwd = process.cwd();
  await withTeacherEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      await captureConsoleAsync(async () => {
        await runVerify({ mission: ".gitagent/missions/stub.yaml", prePush: true });
      });
      assert.equal(process.exitCode, 1);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});

test("runVerify: --pre-push runs full verify when execution claimed", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-pre-push-full-"));
  writeMiniGapmanRepo(dest, ogRoot);
  writeMiniGapmanMission(dest, "MSN-0999", "mission-only trace quote", "echo OK", "OK", "exec.yaml");
  fs.writeFileSync(path.join(dest, "WORKER_LOG.md"), "unrelated worker evidence\n");
  gitInitCommit(dest, "[MSN-0999] legislate mission", TEACHER_EMAIL);
  const prevCwd = process.cwd();
  await withTeacherEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      await runVerify({ mission: ".gitagent/missions/exec.yaml", prePush: true });
      assert.equal(process.exitCode, 1, "trace mapping should fail");
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});

test("runVerify: full verify fails when trace rows still PENDING", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-pending-"));
  writeMiniGapmanRepo(dest, ogRoot);
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, ".gitagent", "missions", "pending.yaml"),
    `msn_id: MSN-0999
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
  gitInitCommit(dest, "[MSN-0999] legislate mission", TEACHER_EMAIL);
  const prevCwd = process.cwd();
  await withTeacherEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      await captureConsoleAsync(async () => {
        await runVerify({ mission: ".gitagent/missions/pending.yaml" });
      });
      assert.equal(process.exitCode, 1);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});

test("runVerify: --fix --non-interactive emits GXT error code on gate failure", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-fix-"));
  writeMiniGapmanRepo(dest, ogRoot);
  writeMiniGapmanMission(dest, "MSN-0999", "evidence A", `bash -lc "exit 1"`, "DONE", "m.yaml");
  gitInitCommit(dest, "[MSN-0999] legislate mission", TEACHER_EMAIL);
  const prevCwd = process.cwd();
  await withTeacherEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      const { output } = await captureConsoleAsync(async () => {
        await runVerify({
          mission: ".gitagent/missions/m.yaml",
          workerLog: "WORKER_LOG.md",
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

test("runVerify: --fix --non-interactive trace_pending lists worker loop steps", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-fix-pending-"));
  writeMiniGapmanRepo(dest, ogRoot);
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
  gitInitCommit(dest, "[MSN-0014] legislate mission", TEACHER_EMAIL);
  const prevCwd = process.cwd();
  await withTeacherEnvAsync(async () => {
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
  writeMiniGapmanRepo(dest, ogRoot);
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
  fs.writeFileSync(path.join(dest, "WORKER_LOG.md"), "OK\n", "utf8");
  gitInitCommit(dest, "[MSN-0014] legislate mission", TEACHER_EMAIL);
  const prevCwd = process.cwd();
  await withTeacherEnvAsync(async () => {
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
      assert.doesNotMatch(combined, /append verbatim trace_quote to .* from worker flight evidence/);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});

test("runVerify: --fix --non-interactive git-proof hint uses mission MSN", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-fix-msn-"));
  writeMiniGapmanRepo(dest, ogRoot);
  writeMiniGapmanMission(dest, "MSN-0014", "evidence A", "echo OK", "OK", "m.yaml");
  gitInitCommit(dest, "chore: init repo", TEACHER_EMAIL);
  const prevCwd = process.cwd();
  await withTeacherEnvAsync(async () => {
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
