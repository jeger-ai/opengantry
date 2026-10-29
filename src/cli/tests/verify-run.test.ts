import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalJson } from "#core/canonical-json.js";
import { runRecordDigest, type RunRecord } from "#core/run-record.js";
import { verifyLedgerChain } from "#plane/ledger-chain.js";
import { getRepoRoot } from "#git/git.js";
import { runVerifyCore } from "../flows/verify-run.js";
import { runLedgerAppend } from "../commands/ledger.js";
import {
  copyMissionSchema,
  gitCommit,
  gitInitCommit,
  writeManifest,
  writeMiniGantryMission,
  writeMiniGantryRepo,
  writeSkillsForManifest,
} from "./test-fixtures.js";
import { PLANNER_EMAIL, withPlannerEnvAsync } from "./test-shared.js";
import { writeLedgerEnabledConfig } from "./test-org-fixtures.js";

function writeRepairFixture(
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

  const libDir = path.join(dest, "src", "cli", "flows");
  fs.mkdirSync(libDir, { recursive: true });
  fs.writeFileSync(
    path.join(libDir, "bad.ts"),
    `import { runVerify } from "../commands/verify.js";\nexport const x = runVerify;\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(dest, "TARGET_ARCHITECTURE.yaml"),
    `schema_version: "0.4.0"
scan_roots: [src/cli/**]
layers:
  - id: command
    globs: [src/cli/commands/**]
  - id: lib
    globs: [src/cli/flows/**]
rules:
  - id: RULE-LIB-TO-COMMAND
    from_layer: lib
    forbid_import_layer: command
`,
    "utf8",
  );

  const missionRel = ".gitagent/missions/repair-receipt.yaml";
  const traceQuote = "repair receipt evidence line";
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, missionRel),
    `msn_id: MSN-0999
skill_key: ui
gate_command: ${gateCommand}
gate_success_substring: '${gateSubstring}'
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

function ledgerKinds(dest: string): string[] {
  return verifyLedgerChain(dest).entries.map((e) => e.entry_kind);
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

test("runVerifyCore: --fix with the ledger on appends one passed receipt entry after repair re-eval", async () => {
  const ogRoot = getRepoRoot();
  const cli = path.join(ogRoot, "dist/cli/index.js");
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-run-receipt-pass-"));
  const missionRel = writeRepairFixture(
    dest,
    ogRoot,
    `node ${cli} arch check --json src/cli/flows/bad.ts`,
    '"ok": true',
  );
  writeLedgerEnabledConfig(dest);
  gitInitCommit(dest, "[MSN-0999] legislate repair mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();

  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      const result = await runVerifyCore({
        mission: missionRel,
        executorLog: "EXECUTOR_LOG.md",
        fix: true,
        fixNonInteractive: true,
      });
      assert.equal(result.ok, true);
      assert.equal(result.exitCode, 0);
      assert.deepEqual(ledgerKinds(dest), ["receipt"]);
      assert.deepEqual(verifyLedgerChain(dest).entries[0]?.payload, { verify_status: "passed" });
    } finally {
      process.chdir(prevCwd);
    }
  });
});

test("runVerifyCore: --fix with the ledger on appends one verify_findings entry when the repair still fails the gate", async () => {
  const ogRoot = getRepoRoot();
  const cli = path.join(ogRoot, "dist/cli/index.js");
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-run-receipt-fail-"));
  const missionRel = writeRepairFixture(
    dest,
    ogRoot,
    `node ${cli} arch check --json src/cli/flows/bad.ts; exit 1`,
    "NEVER_MATCHES",
  );
  writeLedgerEnabledConfig(dest);
  gitInitCommit(dest, "[MSN-0999] legislate repair fail mission", PLANNER_EMAIL);
  const prevCwd = process.cwd();

  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      const result = await runVerifyCore({
        mission: missionRel,
        executorLog: "EXECUTOR_LOG.md",
        fix: true,
        fixNonInteractive: true,
      });
      assert.equal(result.ok, false);
      assert.equal(result.exitCode, 1);
      assert.deepEqual(ledgerKinds(dest), ["verify_findings"]);
    } finally {
      process.chdir(prevCwd);
    }
  });
});

test("verify --export: envelope 2.0 over the run record round-trips into ledger append --from-envelope (ADR-0061)", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-run-export-"));
  const missionRel = writeMiniGantryRepo(dest, ogRoot);
  fs.writeFileSync(path.join(dest, missionRel), 'msn_id: MSN-0999\nskill_key: ui\ngate_command: echo DONE\ngate_success_substring: "DONE"\n', "utf8");
  fs.writeFileSync(path.join(dest, ".gitignore"), ".gitagent/history/\n.gitagent/tmp/\n", "utf8");
  writeLedgerEnabledConfig(dest);
  gitInitCommit(dest, "[MSN-0999] legislate rowless mission", PLANNER_EMAIL);
  const envelopePath = path.join(dest, "envelope.json");
  const prevCwd = process.cwd();

  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      const noRecord = await runVerifyCore({ mission: missionRel, exportPath: "envelope.json" });
      assert.equal(noRecord.ok, false, "a failed verify (no run record yet) writes no envelope");
      assert.equal(fs.existsSync(envelopePath), false);

      assert.equal((await runVerifyCore({ mission: missionRel, record: true })).ok, true);
      gitCommit(dest, "[MSN-0999] Run record");
      assert.equal((await runVerifyCore({ mission: missionRel, exportPath: "envelope.json" })).ok, true);

      const record = JSON.parse(fs.readFileSync(path.join(dest, ".gitagent/runs/MSN-0999.json"), "utf8")) as RunRecord;
      const envelope = JSON.parse(fs.readFileSync(envelopePath, "utf8")) as { envelope_schema_version: string; payload_b64: string; signature?: unknown };
      assert.equal(envelope.envelope_schema_version, "2.0.0");
      assert.equal(Buffer.from(envelope.payload_b64, "base64").toString("utf8"), canonicalJson(record));
      assert.equal(envelope.signature, undefined);

      runLedgerAppend({ fromEnvelope: envelopePath });
      const entries = verifyLedgerChain(dest).entries;
      const passed = { verify_status: "passed", run_record_sha256: runRecordDigest(record) };
      assert.deepEqual(entries.map((e) => e.entry_kind), ["verify_findings", "receipt", "receipt", "receipt"]);
      for (const e of entries.slice(1)) {
        assert.equal(e.msn_id, "MSN-0999");
        assert.deepEqual(e.payload, passed);
      }
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});
