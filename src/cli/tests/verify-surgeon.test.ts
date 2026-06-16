import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRepoRoot } from "../lib/git.js";
import { runVerify } from "../commands/verify.js";
import {
  copyMissionSchema,
  gitInitCommit,
  writeManifest,
  writeSkillsForManifest,
} from "./test-fixtures.js";
import { captureConsoleAsync, TEACHER_EMAIL, withTeacherEnvAsync } from "./test-shared.js";

function writeSurgeonFixtureRepo(
  dest: string,
  ogRoot: string,
  options: { gateCommand: string; gateSubstring: string },
): string {
  copyMissionSchema(path.join(ogRoot, ".gitagent", "teacher"), path.join(dest, ".gitagent", "teacher"));
  writeManifest(dest, {
    ui: { trust_threshold: "Tier-1", tmvc_roots: [], forbidden_zones: [] },
  });
  writeSkillsForManifest(dest, ["ui"]);

  fs.mkdirSync(path.join(dest, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, "src", "bad.ts"),
    `import axios from "axios";\nexport const x = 1;\n`,
    "utf8",
  );

  const missionRel = ".gitagent/missions/surgeon-ban.yaml";
  const traceQuote = "surgeon quarantine evidence line";
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, missionRel),
    `msn_id: MSN-0999
skill_key: ui
gate_command: ${options.gateCommand}
gate_success_substring: "${options.gateSubstring}"
trace_rows:
  - dod_id: "1"
    trace_quote: "${traceQuote}"
    anchor: "1"
    status: PASS
`,
    "utf8",
  );
  fs.writeFileSync(path.join(dest, "WORKER_LOG.md"), `${traceQuote}\n`, "utf8");
  return missionRel;
}

test("runVerify: --fix quarantines banned import, logs mutation, reruns verify", async () => {
  const ogRoot = getRepoRoot();
  const cli = path.join(ogRoot, "dist/cli/index.js");
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-surgeon-fix-"));
  const missionRel = writeSurgeonFixtureRepo(dest, ogRoot, {
    gateCommand: `node ${cli} check-imports src --ban axios`,
    gateSubstring: "check-imports: OK",
  });
  gitInitCommit(dest, "[MSN-0999] legislate surgeon mission", TEACHER_EMAIL);

  const badPath = path.join(dest, "src/bad.ts");
  const before = fs.readFileSync(badPath, "utf8");
  const prevCwd = process.cwd();

  await withTeacherEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      const { output } = await captureConsoleAsync(async () => {
        await runVerify({
          mission: missionRel,
          workerLog: "WORKER_LOG.md",
          fix: true,
          fixNonInteractive: true,
        });
      });
      const combined = output.stdout + output.stderr;
      const after = fs.readFileSync(badPath, "utf8");
      const workerLog = fs.readFileSync(path.join(dest, "WORKER_LOG.md"), "utf8");

      assert.notEqual(after, before);
      assert.match(after, /GXT-SURGEON-QUARANTINE-START/);
      assert.match(workerLog, /\[SURGEON-MUTATION\] banned-import quarantined: src\/bad\.ts:1 -> RULE-BANNED-IMPORT/);
      assert.match(combined, /\[Surgeon\] mutation logged; rerunning full verify \(fix disabled\)/);
      assert.equal(process.exitCode ?? 0, 0);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});

test("runVerify: without --fix does not quarantine banned import", async () => {
  const ogRoot = getRepoRoot();
  const cli = path.join(ogRoot, "dist/cli/index.js");
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-surgeon-plain-"));
  const missionRel = writeSurgeonFixtureRepo(dest, ogRoot, {
    gateCommand: `node ${cli} check-imports src --ban axios`,
    gateSubstring: "check-imports: OK",
  });
  gitInitCommit(dest, "[MSN-0999] legislate surgeon mission", TEACHER_EMAIL);

  const badPath = path.join(dest, "src/bad.ts");
  const before = fs.readFileSync(badPath, "utf8");
  const prevCwd = process.cwd();

  await withTeacherEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      const { output } = await captureConsoleAsync(async () => {
        await runVerify({ mission: missionRel, workerLog: "WORKER_LOG.md" });
      });
      const combined = output.stdout + output.stderr;
      const after = fs.readFileSync(badPath, "utf8");
      const workerLog = fs.readFileSync(path.join(dest, "WORKER_LOG.md"), "utf8");

      assert.equal(after, before);
      assert.doesNotMatch(workerLog, /\[SURGEON-MUTATION\]/);
      assert.equal(process.exitCode, 1);
      assert.match(combined, /GXT_BANNED_IMPORT_DETECTED|GXT_GATE_FAILED/);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});

test("runVerify: --fix writes only one SURGEON-MUTATION line on successful rerun", async () => {
  const ogRoot = getRepoRoot();
  const cli = path.join(ogRoot, "dist/cli/index.js");
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-surgeon-once-"));
  const missionRel = writeSurgeonFixtureRepo(dest, ogRoot, {
    gateCommand: `node ${cli} check-imports src --ban axios`,
    gateSubstring: "check-imports: OK",
  });
  gitInitCommit(dest, "[MSN-0999] legislate surgeon mission", TEACHER_EMAIL);

  const prevCwd = process.cwd();
  await withTeacherEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      await captureConsoleAsync(async () => {
        await runVerify({
          mission: missionRel,
          workerLog: "WORKER_LOG.md",
          fix: true,
          fixNonInteractive: true,
        });
      });
      const workerLog = fs.readFileSync(path.join(dest, "WORKER_LOG.md"), "utf8");
      const matches = workerLog.match(/\[SURGEON-MUTATION\]/g);
      assert.equal(matches?.length ?? 0, 1);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});
