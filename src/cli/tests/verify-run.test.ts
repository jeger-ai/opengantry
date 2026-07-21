import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { REL_RECEIPTS_DIR } from "../lib/constants.js";
import { getRepoRoot } from "../lib/git.js";
import { runVerifyCore } from "../lib/verify-run.js";
import {
  copyMissionSchema,
  gitInitCommit,
  writeManifest,
  writeMiniGantryMission,
  writeMiniGantryRepo,
  writeSkillsForManifest,
} from "./test-fixtures.js";
import { PLANNER_EMAIL, withPlannerEnvAsync } from "./test-shared.js";

function writeSurgeonReceiptFixture(
  dest: string,
  ogRoot: string,
  gateCommand: string,
  gateSubstring: string,
): string {
  copyMissionSchema(path.join(ogRoot, ".gitagent", "planner"), path.join(dest, ".gitagent", "planner"));
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

  const missionRel = ".gitagent/missions/surgeon-receipt.yaml";
  const traceQuote = "surgeon receipt evidence line";
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, missionRel),
    `msn_id: MSN-0999
skill_key: ui
gate_command: ${gateCommand}
gate_success_substring: "${gateSubstring}"
trace_rows:
  - dod_id: "1"
    trace_quote: "${traceQuote}"
    anchor: "1"
    status: PASS
`,
    "utf8",
  );
  fs.writeFileSync(path.join(dest, "EXECUTOR_LOG.md"), `${traceQuote}\n`, "utf8");
  return missionRel;
}

function listReceiptFiles(dest: string): string[] {
  const dir = path.join(dest, REL_RECEIPTS_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
}

test("runVerifyCore: returns typed result without setting process.exitCode on success", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-run-"));
  writeMiniGantryRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      const result = await runVerifyCore({
        mission: ".gitagent/missions/m.yaml",
        executorLog: "EXECUTOR_LOG.md",
      });
      assert.equal(result.ok, true);
      assert.equal(result.exitCode, 0);
      assert.equal(process.exitCode, undefined, "runVerifyCore must not set process.exitCode");
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});

test("runVerifyCore: returns failure exit code for gate failure", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-run-gate-"));
  writeMiniGantryRepo(dest, ogRoot);
  writeMiniGantryMission(dest, "MSN-0999", "evidence A", `bash -lc "exit 1"`, "DONE", "m.yaml");
  gitInitCommit(dest, "[MSN-0999] legislate mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      const result = await runVerifyCore({
        mission: ".gitagent/missions/m.yaml",
        executorLog: "EXECUTOR_LOG.md",
      });
      assert.equal(result.ok, false);
      assert.equal(result.exitCode, 1);
      assert.equal(process.exitCode, undefined, "runVerifyCore must not set process.exitCode");
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});

test("runVerifyCore: --fix + --receipt writes one passed receipt after surgeon re-eval", async () => {
  const ogRoot = getRepoRoot();
  const cli = path.join(ogRoot, "dist/cli/index.js");
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-run-receipt-pass-"));
  const missionRel = writeSurgeonReceiptFixture(
    dest,
    ogRoot,
    `node ${cli} check-imports src --ban axios`,
    "check-imports: OK",
  );
  gitInitCommit(dest, "[MSN-0999] legislate surgeon receipt mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();

  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      const result = await runVerifyCore({
        mission: missionRel,
        executorLog: "EXECUTOR_LOG.md",
        fix: true,
        fixNonInteractive: true,
        receipt: true,
      });
      assert.equal(result.ok, true);
      assert.equal(result.exitCode, 0);
      const receipts = listReceiptFiles(dest);
      assert.equal(receipts.length, 1);
      const receipt = JSON.parse(
        fs.readFileSync(path.join(dest, REL_RECEIPTS_DIR, receipts[0]!), "utf8"),
      ) as { verify_status: string };
      assert.equal(receipt.verify_status, "passed");
    } finally {
      process.chdir(prevCwd);
    }
  });
});

test("runVerifyCore: --fix + --receipt writes one failed receipt when surgeon fix still fails gate", async () => {
  const ogRoot = getRepoRoot();
  const cli = path.join(ogRoot, "dist/cli/index.js");
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-run-receipt-fail-"));
  const missionRel = writeSurgeonReceiptFixture(
    dest,
    ogRoot,
    `node ${cli} check-imports src --ban axios; exit 1`,
    "NEVER_MATCHES",
  );
  gitInitCommit(dest, "[MSN-0999] legislate surgeon receipt fail mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();

  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      const result = await runVerifyCore({
        mission: missionRel,
        executorLog: "EXECUTOR_LOG.md",
        fix: true,
        fixNonInteractive: true,
        receipt: true,
      });
      assert.equal(result.ok, false);
      assert.equal(result.exitCode, 1);
      const receipts = listReceiptFiles(dest);
      assert.equal(receipts.length, 1);
      const receipt = JSON.parse(
        fs.readFileSync(path.join(dest, REL_RECEIPTS_DIR, receipts[0]!), "utf8"),
      ) as { verify_status: string; error_code?: string };
      assert.equal(receipt.verify_status, "failed");
      assert.ok(receipt.error_code);
    } finally {
      process.chdir(prevCwd);
    }
  });
});
