import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { LEGISLATE_TRACE_PLACEHOLDER } from "../lib/constants.js";
import { GXT_ERROR } from "../lib/gxt-error-codes.js";
import { getRepoRoot } from "../lib/git.js";
import { isStubOperatorAnswer } from "../lib/interrogate/answers.js";
import { interrogationSha256, stableFindingId } from "../lib/interrogate/findings.js";
import { REL_PLANNER_ALLOWLIST } from "../lib/planner-identity.js";
import { parseMissionFile } from "../lib/missions/parser.js";
import type { ParsedMission } from "../lib/types.js";
import { loadManifest } from "../lib/manifest.js";
import { evaluateInterrogationPhase } from "../lib/verify-interrogation.js";
import { handleDraftLegislation } from "../lib/mcp-draft-legislation.js";
import { copyMissionSchema, gitCommit, gitInitCommit, writeManifest } from "./test-fixtures.js";

const PLANNER = "planner@example.com";
const EXECUTOR = "executor@example.com";

function runInterrogationPhaseInTest(
  dest: string,
  manifest: ReturnType<typeof loadManifest>,
  mission: ParsedMission,
  missionRel: string,
  options: { requireInterrogation?: boolean },
  proofMsnId: string,
) {
  return evaluateInterrogationPhase({
    root: dest,
    manifest,
    mission,
    missionRel,
    options,
    proofMsnId,
    executorLogPath: path.join(dest, "EXECUTOR_LOG.md"),
  });
}

function sampleRow(operatorAnswer = "Operator approved for verify phase test.") {
  const finding_id = stableFindingId("missing_test_criteria", "gate:echo OK");
  return {
    finding_id,
    kind: "missing_test_criteria" as const,
    question: "Gate not allowlisted",
    hypothesis: "echo OK acceptable",
    operator_answer: operatorAnswer,
  };
}

function writeInterrogationMission(
  dest: string,
  msnId: string,
  missionRel: string,
  rows: ReturnType<typeof sampleRow>[],
  traceQuote = LEGISLATE_TRACE_PLACEHOLDER,
): void {
  const sha = interrogationSha256(rows);
  const yaml = `msn_id: ${msnId}
skill_key: gantry
gate_command: "echo OK"
gate_success_substring: "OK"
declared_paths: []
interrogation_sha256: "${sha}"
interrogation:
  - finding_id: "${rows[0]!.finding_id}"
    kind: ${rows[0]!.kind}
    question: "${rows[0]!.question}"
    hypothesis: "${rows[0]!.hypothesis}"
    operator_answer: "${rows[0]!.operator_answer}"
trace_rows:
  - dod_id: "1"
    trace_quote: "${traceQuote}"
    anchor: "1"
    status: PASS
`;
  fs.mkdirSync(path.dirname(path.join(dest, missionRel)), { recursive: true });
  fs.writeFileSync(path.join(dest, missionRel), yaml, "utf8");
}

function scaffoldDriftRepo(): { dest: string; missionRel: string; msnId: string } {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-interrogate-phase-"));
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.mkdirSync(path.join(dest, ".gitagent", "planner"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "planner", "MISSION.schema.yaml"),
    path.join(dest, ".gitagent", "planner", "MISSION.schema.yaml"),
  );
  fs.writeFileSync(
    path.join(dest, REL_PLANNER_ALLOWLIST),
    `${PLANNER}\n`,
    "utf8",
  );
  writeManifest(
    dest,
    {
      gantry: {
        trust_threshold: "Tier-2",
        tmvc_roots: ["src/cli/"],
        forbidden_zones: [],
        gate_commands: ["npm test"],
      },
    },
    { ".gitagent/": "Tier-3", "src/cli/": "Tier-2" },
  );
  gitInitCommit(dest, "init substrate", PLANNER);
  const msnId = "MSN-0930";
  const missionRel = `.gitagent/missions/${msnId}.drift.yaml`;
  const rows = [sampleRow()];
  writeInterrogationMission(dest, msnId, missionRel, rows);
  execSync("git add -A", { cwd: dest, stdio: "pipe" });
  execSync(`git -C "${dest}" commit -m "[${msnId}] legislate drift fixture" --author="Planner <${PLANNER}>"`, {
    stdio: "pipe",
  });
  return { dest, missionRel, msnId };
}

test("isStubOperatorAnswer: exact placeholder matches only", () => {
  assert.equal(isStubOperatorAnswer("PENDING_OPERATOR_RESPONSE"), true);
  assert.equal(isStubOperatorAnswer("REPLACE_WITH_OPERATOR_ANSWER"), true);
  assert.equal(isStubOperatorAnswer(LEGISLATE_TRACE_PLACEHOLDER), true);
  assert.equal(isStubOperatorAnswer("Do not use REPLACE_WITH_OPERATOR_ANSWER literally in prod"), false);
});

test("evaluateInterrogationPhase: requireInterrogation fails when block missing", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-interrogate-req-"));
  copyMissionSchema(path.join(ogRoot, ".gitagent", "planner"), path.join(dest, ".gitagent", "planner"));
  writeManifest(dest, {
    gantry: { trust_threshold: "Tier-2", tmvc_roots: ["src/cli/"], forbidden_zones: [] },
  });
  const missionRel = ".gitagent/missions/m.yaml";
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, missionRel),
    `msn_id: MSN-0931
skill_key: gantry
gate_command: "echo OK"
gate_success_substring: "OK"
trace_rows: []
`,
    "utf8",
  );
  const mission = parseMissionFile(dest, missionRel);
  const manifest = loadManifest(dest);
  const outcome = runInterrogationPhaseInTest(dest, manifest, mission, missionRel, { requireInterrogation: true }, "MSN-0931");
  assert.equal(outcome.failure?.interrogationCode, GXT_ERROR.INTERROGATION_REQUIRED);
});

test("evaluateInterrogationPhase: stub operator answer fails on legislative stub mission", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-interrogate-stub-"));
  copyMissionSchema(path.join(ogRoot, ".gitagent", "planner"), path.join(dest, ".gitagent", "planner"));
  writeManifest(dest, {
    gantry: { trust_threshold: "Tier-2", tmvc_roots: ["src/cli/"], forbidden_zones: [] },
  });
  const missionRel = ".gitagent/missions/stub.yaml";
  const rows = [sampleRow("PENDING_OPERATOR_RESPONSE")];
  writeInterrogationMission(dest, "MSN-0932", missionRel, rows);
  const mission = parseMissionFile(dest, missionRel);
  const manifest = loadManifest(dest);
  const outcome = runInterrogationPhaseInTest(dest, manifest, mission, missionRel, {}, "MSN-0932");
  assert.equal(outcome.failure?.interrogationCode, GXT_ERROR.INTERROGATION_STUB);
});

test("evaluateInterrogationPhase: missing interrogation_sha256 fails closed", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-interrogate-nosha-"));
  writeManifest(dest, {
    gantry: { trust_threshold: "Tier-2", tmvc_roots: ["src/cli/"], forbidden_zones: [] },
  });
  const missionRel = ".gitagent/missions/nosha.yaml";
  const rows = [sampleRow()];
  const mission: ParsedMission = {
    msnId: "MSN-0933",
    skillKey: "gantry",
    gate: { command: "echo OK", successSubstring: "OK" },
    kpiGate: null,
    virtualCapture: false,
    llmVerifiers: [],
    aggregators: [],
    traceRows: [],
    interrogation: rows,
    interrogationSha256: null,
    declaredPaths: [],
    rawPath: path.join(dest, missionRel),
  };
  const manifest = loadManifest(dest);
  const outcome = runInterrogationPhaseInTest(dest, manifest, mission, missionRel, {}, "MSN-0933");
  assert.equal(outcome.failure?.interrogationCode, GXT_ERROR.INTERROGATION_MISMATCH);
});

test("path drift: mission file in stamp commit is excluded", () => {
  const { dest, missionRel, msnId } = scaffoldDriftRepo();
  const mission = parseMissionFile(dest, missionRel);
  const manifest = loadManifest(dest);
  const outcome = runInterrogationPhaseInTest(dest, manifest, mission, missionRel, {}, msnId);
  assert.equal(outcome.failure, null);
});

test("path drift: mission file edited in later executor commit fires", () => {
  const { dest, missionRel, msnId } = scaffoldDriftRepo();
  const missionAbs = path.join(dest, missionRel);
  const body = fs.readFileSync(missionAbs, "utf8");
  fs.writeFileSync(missionAbs, `${body}\n# executor edit\n`, "utf8");
  gitCommit(dest, `[${msnId}] executor self-edit`, EXECUTOR);
  const mission = parseMissionFile(dest, missionRel);
  const manifest = loadManifest(dest);
  const outcome = runInterrogationPhaseInTest(dest, manifest, mission, missionRel, {}, msnId);
  assert.equal(outcome.failure?.interrogationCode, GXT_ERROR.INTERROGATION_PATH_DRIFT);
});

test("path drift: spoofed planner commit with Tier-3 app path still fires", () => {
  const { dest, missionRel, msnId } = scaffoldDriftRepo();
  const tier3 = path.join(dest, ".gitagent", "foreman", "SMUGGLE.txt");
  fs.writeFileSync(tier3, "smuggle\n", "utf8");
  execSync("git add -A", { cwd: dest, stdio: "pipe" });
  execSync(
    `git -C "${dest}" commit -m "[${msnId}] spoof planner bundle" --author="Planner <${PLANNER}>"`,
    { stdio: "pipe" },
  );
  const mission = parseMissionFile(dest, missionRel);
  const manifest = loadManifest(dest);
  const outcome = runInterrogationPhaseInTest(dest, manifest, mission, missionRel, {}, msnId);
  assert.equal(outcome.failure?.interrogationCode, GXT_ERROR.INTERROGATION_PATH_DRIFT);
});

test("handleDraftLegislation: incomplete interrogation returns INTERROGATION_INCOMPLETE", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-draft-incomplete-"));
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "foreman", "MANIFEST.json"),
    path.join(dest, ".gitagent", "foreman", "MANIFEST.json"),
  );
  execSync("git init", { cwd: dest, stdio: "pipe" });
  execSync('git config user.email "teacher@example.com"', { cwd: dest, stdio: "pipe" });
  execSync('git config user.name "Fixture"', { cwd: dest, stdio: "pipe" });
  execSync("git add -A", { cwd: dest, stdio: "pipe" });
  execSync('git commit -m "init"', { cwd: dest, stdio: "pipe" });
  const prevCwd = process.cwd();
  process.chdir(dest);
  try {
    const result = handleDraftLegislation({
      title: "Incomplete gate",
      msn_id: "MSN-0934",
      skill_key: "gantry",
      gate_command: "echo OK",
      interrogation: [],
    });
    assert.equal(result.status, "error");
    if (result.status === "error") {
      assert.equal(result.error.code, "INTERROGATION_INCOMPLETE");
    }
  } finally {
    process.chdir(prevCwd);
  }
});
