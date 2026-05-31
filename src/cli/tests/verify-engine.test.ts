import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getRepoRoot } from "../lib/git.js";
import { LEGISLATE_TRACE_PLACEHOLDER } from "../lib/mission-legislative-stub.js";
import { runVerify } from "../commands/verify.js";
import { resolveGateWorkDir } from "../lib/verify-engine.js";
import { writeMiniGapmanRepo, writeMiniGapmanMission, gitInitCommit } from "./test-fixtures.js";
import { captureConsoleAsync, TEACHER_EMAIL, withTeacherEnvAsync } from "./test-shared.js";

test("resolveGateWorkDir: honors verify --cwd", () => {
  const root = "/repo";
  assert.equal(resolveGateWorkDir(root, { mission: "m.yaml", cwd: "pkg" }), path.resolve(root, "pkg"));
  assert.equal(resolveGateWorkDir(root, { mission: "m.yaml" }), root);
});

test("runVerify --fix: gate evaluated once (same cwd semantics as normal verify)", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-cwd-"));
  writeMiniGapmanRepo(dest, ogRoot);
  fs.mkdirSync(path.join(dest, "sub"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, "sub", "marker"),
    "gate-ran-here\n",
    "utf8",
  );
  writeMiniGapmanMission(
    dest,
    "MSN-0999",
    "gate-ran-here",
    'bash -lc "cat marker >> ../WORKER_LOG.md && echo OK"',
    "OK",
    "cwd.yaml",
  );
  gitInitCommit(dest, "[MSN-0999] legislate mission", TEACHER_EMAIL);
  const prevCwd = process.cwd();
  await withTeacherEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      await runVerify({
        mission: ".gitagent/missions/cwd.yaml",
        workerLog: "WORKER_LOG.md",
        cwd: "sub",
      });
      assert.equal(process.exitCode, undefined, "gate in sub/ should pass with trace match");
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});

test("runVerify --fix --non-interactive: worker audience filters next actions", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-audience-"));
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
      const { output } = await captureConsoleAsync(async () => {
        await runVerify({
          mission: ".gitagent/missions/pending.yaml",
          fix: true,
          fixNonInteractive: true,
          audience: "worker",
        });
      });
      const combined = output.stdout + output.stderr;
      assert.equal(process.exitCode, 1);
      assert.match(combined, /Worker next steps/);
      assert.match(combined, /runtime env --mission \.gitagent\/missions\/pending\.yaml/);
      assert.doesNotMatch(combined, /gapman verify --mission.*next actions/s);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});
