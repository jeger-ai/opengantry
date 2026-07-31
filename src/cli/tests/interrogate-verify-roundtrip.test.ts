import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { runLegislate } from "../lib/legislate.js";
import { buildAttestationReceipt } from "../lib/attestation-receipt.js";
import { GXT_ERROR } from "../lib/gxt-error-codes.js";
import { getRepoRoot } from "../lib/git.js";
import { stableFindingId } from "../lib/interrogate/findings.js";
import { runInterrogate } from "../lib/interrogate/run.js";
import { loadManifest } from "../lib/manifest.js";
import { parseMissionFile } from "../lib/missions/parser.js";
import { evaluateInterrogationPhase } from "../lib/verify-interrogation.js";
import { copyMissionSchema, writeOrgExportConfig, isolateOrgAttributionEnv } from "./test-fixtures.js";

function scaffoldGantryLegislateRepo(): string {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-interrogate-roundtrip-"));
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.mkdirSync(path.join(dest, ".gitagent", "planner"), { recursive: true });
  copyMissionSchema(path.join(ogRoot, ".gitagent", "planner"), path.join(dest, ".gitagent", "planner"));
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "foreman", "MANIFEST.json"),
    path.join(dest, ".gitagent", "foreman", "MANIFEST.json"),
  );
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  execSync("git init", { cwd: dest, stdio: "pipe" });
  execSync('git config user.email "teacher@example.com"', { cwd: dest, stdio: "pipe" });
  execSync('git config user.name "Fixture"', { cwd: dest, stdio: "pipe" });
  execSync("git add -A", { cwd: dest, stdio: "pipe" });
  execSync('git commit -m "init"', { cwd: dest, stdio: "pipe" });
  writeOrgExportConfig(dest);
  return dest;
}

function legislateWithEchoOkAnswer(dest: string, msnId: string): string {
  const manifest = loadManifest(dest);
  const gate = "echo OK";
  const halt = runInterrogate({
    root: dest,
    manifest,
    intent: "gantry cli helper tweak",
    skillKey: "gantry",
    gateCommand: gate,
    gateSuccessSubstring: "OK",
    paths: [],
    interrogation: [],
  });
  assert.equal(halt.status, "halt");
  if (halt.status !== "halt") throw new Error("expected halt");
  const finding_id = stableFindingId("missing_test_criteria", `gate:${gate}`);
  const clear = runInterrogate({
    root: dest,
    manifest,
    intent: "gantry cli helper tweak",
    skillKey: "gantry",
    gateCommand: gate,
    gateSuccessSubstring: "OK",
    paths: [],
    interrogation: [
      {
        finding_id,
        kind: "missing_test_criteria",
        question: halt.next_question.question,
        hypothesis: halt.next_question.hypothesis,
        operator_answer: "Operator approved echo OK for roundtrip test.",
      },
    ],
  });
  assert.equal(clear.status, "clear");
  if (clear.status !== "clear") throw new Error("expected clear");

  const result = runLegislate({
    intent: "gantry cli helper tweak",
    msn: msnId,
    skillKey: "gantry",
    gateCommand: gate,
    gateSuccessSubstring: "OK",
    interrogation: {
      source: "operator_file",
      rows: clear.interrogation,
    },
    silent: true,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("legislate failed");
  return result.missionRel;
}

test("interrogation tamper: verify fails GXT_INTERROGATION_MISMATCH when answer edited", () => {
  const dest = scaffoldGantryLegislateRepo();
  const prevCwd = process.cwd();
  process.chdir(dest);
  try {
    const missionRel = legislateWithEchoOkAnswer(dest, "MSN-0911");
    const missionAbs = path.join(dest, missionRel);
    const body = fs.readFileSync(missionAbs, "utf8");
    fs.writeFileSync(
      missionAbs,
      body.replace(
        "Operator approved echo OK for roundtrip test.",
        "Operator approved echo OK for roundtrip test — amended.",
      ),
      "utf8",
    );
    const mission = parseMissionFile(dest, missionRel);
    const manifest = loadManifest(dest);
    const outcome = evaluateInterrogationPhase({
      root: dest,
      manifest,
      mission,
      missionRel: missionRel.replace(/\\/g, "/"),
      options: { requireInterrogation: false },
      proofMsnId: mission.msnId!,
      executorLogPath: path.join(dest, "EXECUTOR_LOG.md"),
    });
    assert.ok(outcome.failure);
    if (!outcome.failure) return;
    assert.equal(outcome.failure.interrogationCode, GXT_ERROR.INTERROGATION_MISMATCH);
  } finally {
    process.chdir(prevCwd);
  }
});

test("interrogation attestation: mission_sha256 changes when operator_answer changes", () => {
  isolateOrgAttributionEnv(() => {
    const dest = scaffoldGantryLegislateRepo();
    const prevCwd = process.cwd();
    process.chdir(dest);
    try {
      const missionRel = legislateWithEchoOkAnswer(dest, "MSN-0912");
      const missionArg = missionRel;
      const mission1 = parseMissionFile(dest, missionArg);
      const receipt1 = buildAttestationReceipt({
        root: dest,
        mission: mission1,
        missionArg,
        verifyStatus: "attest_only",
      });

      const missionAbs = path.join(dest, missionRel);
      const body = fs.readFileSync(missionAbs, "utf8");
      fs.writeFileSync(
        missionAbs,
        body.replace(
          "Operator approved echo OK for roundtrip test.",
          "Operator approved echo OK for roundtrip test — different answer.",
        ),
        "utf8",
      );

      const mission2 = parseMissionFile(dest, missionArg);
      const receipt2 = buildAttestationReceipt({
        root: dest,
        mission: mission2,
        missionArg,
        verifyStatus: "attest_only",
      });
      assert.notEqual(receipt1.mission_sha256, receipt2.mission_sha256);
    } finally {
      process.chdir(prevCwd);
    }
  });
});
