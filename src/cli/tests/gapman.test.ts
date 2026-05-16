import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { getRepoRoot } from "../lib/git.js";
import {
  assertTeacherMissionProof,
  commitSubjectHasMsnPrefix,
  extractMsnIdFromMissionFile,
  missionPathRepoRelative,
} from "../lib/git-proof.js";
import { isMarkdownTableSeparatorRow, parseMarkdownMission, parseMissionFile } from "../lib/mission-parser.js";
import { loadManifest } from "../lib/manifest.js";
import { checkSkillManifestSync } from "../lib/skill-sync.js";
import { formatTriageHuman, triageIntent } from "../lib/triage-logic.js";
import { verifyTraceRows } from "../lib/trace.js";
import { runLegislate } from "../commands/legislate.js";
import { runVerify } from "../commands/verify.js";
import { allocateNextMsnId } from "../lib/next-msn.js";
import { resolveRuntimeEnv } from "../lib/runtime-env.js";
import { runRuntimeExec } from "../lib/runtime-exec.js";
import { loadWorkspace } from "../lib/workspace.js";

/**
 * ## Full `gapman verify` example (mirrors `runVerify: passes with Teacher git-proof in mini repo`)
 *
 * **Layout**
 * - `.gitagent/foreman/MANIFEST.json` — must include the mission’s `skill_key` (and any fields `mission validate` needs).
 * - `.gitagent/teacher/MISSION.schema.yaml` — copy from the OpenGantry repo under test (`writeMiniGapmanRepo`).
 * - `.gitagent/missions/<file>.yaml` — mission path must stay under `missions/` for git-proof.
 * - Repo-root `WORKER_LOG.md` — each **PASS** row: `trace_quote` appears verbatim in the file; if `anchor` is all digits, that 1-based line must contain the quote.
 *
 * **Mission YAML** (same shape as {@link writeMiniGapmanRepo}; MSN and quotes must match git + log):
 *
 * ```yaml
 * msn_id: MSN-0999
 * skill_key: ui-ralph
 * gate_command: "echo DONE"
 * gate_success_substring: "DONE"
 * trace_rows:
 *   - dod_id: "1"
 *     trace_quote: "evidence A"
 *     anchor: "1"
 *     status: PASS
 * ```
 *
 * **WORKER_LOG.md** (line 1 must include the quote when `anchor` is `"1"`):
 *
 * ```text
 * evidence A
 * ```
 *
 * **Git proof** — `git init`, set `user.email` to an address listed in `GAPMAN_TEACHER_EMAILS`, then commit all of the above with a **subject** starting with `[MSN-0999]` (same id as `msn_id`). Body text does not count toward the subject-line stamp.
 *
 * **Environment** — `GAPMAN_TEACHER_EMAILS=<that user.email>` (comma-separated allowlist; case-insensitive).
 *
 * **Run** — repo root: `runVerify({ mission: ".gitagent/missions/m.yaml", workerLog: "WORKER_LOG.md" })`, or CLI: `node dist/cli/index.js verify --mission .gitagent/missions/m.yaml`.
 *
 * The tracked mission `.gitagent/missions/example.verify.yaml` is the same contract with `MSN-0012` and trace line `example trace line for gapman verify` on line 1 of `WORKER_LOG.md`.
 */

test("triage: risk_keyword triggers escalation", () => {
  const root = getRepoRoot();
  const m = loadManifest(root);
  const r = triageIntent("refactor ui-ralph", m);
  assert.equal(r.action, "LEGISLATIVE_ESCALATION");
});

test("formatTriageHuman includes action line", () => {
  const root = getRepoRoot();
  const m = loadManifest(root);
  const r = triageIntent("logic-ralph only", m);
  const text = formatTriageHuman(r);
  assert.match(text, /^Action: DIRECT_EXECUTION/m);
});

test("triage: optional ADR hints when match_terms overlap intent", () => {
  const root = getRepoRoot();
  const m = loadManifest(root);
  const r = triageIntent("ui-ralph tweak example widget", m);
  assert.equal(r.action, "DIRECT_EXECUTION");
  assert.ok(r.adr_hints?.length, "expected adr_hints");
  assert.ok(r.adr_hints?.some((h) => h.id === "ADR-0001"), "expected ADR-0001 hint");
});

test("parseMarkdownMission: Success alias maps substring", () => {
  const body = `# Mission: MSN-0001

## 3. Deterministic gate

**Command:** \`echo X\`
**Success:** output contains X
`;
  const p = parseMarkdownMission("/tmp/m.md", body);
  assert.equal(p.gate?.command, "echo X");
  assert.equal(p.gate?.successSubstring, "output contains X");
});

test("commitSubjectHasMsnPrefix: requires tag on subject line", () => {
  assert.equal(commitSubjectHasMsnPrefix("[MSN-0999] legislate", "MSN-0999"), true);
  assert.equal(commitSubjectHasMsnPrefix("  [MSN-0999] legislate", "MSN-0999"), true);
  assert.equal(commitSubjectHasMsnPrefix("init only", "MSN-0999"), false);
  assert.equal(commitSubjectHasMsnPrefix("[MSN-0001] x", "MSN-0999"), false);
});

test("isMarkdownTableSeparatorRow: dash cells vs data containing ---", () => {
  assert.equal(isMarkdownTableSeparatorRow("| --- | :--- |------|"), true);
  assert.equal(isMarkdownTableSeparatorRow("| 1 | foo---bar | 2 | PASS |"), false);
});

test("parseMarkdownMission: trace quote may contain --- without dropping row", () => {
  const body = `## 4. Verification trace

| DoD # | Trace quote (from WORKER_LOG) | Line or timestamp | Status |
|-------|-------------------------------|-------------------|--------|
| 1 | marker---end | 2 | PASS |
`;
  const m = parseMarkdownMission("x.md", body);
  assert.equal(m.traceRows.length, 1);
  assert.equal(m.traceRows[0]?.traceQuote, "marker---end");
});

test("git-proof: MISSION_MISSING_MSN", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-gitpf-"));
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  const missionAbs = path.join(dest, ".gitagent", "missions", "nomsn.md");
  fs.writeFileSync(
    missionAbs,
    `## 3. Deterministic gate\n\n**Command:** \`echo 1\`\n**Success criteria:** 1\n`,
    "utf8",
  );
  assert.throws(() => assertTeacherMissionProof(dest, missionAbs), /MISSION_MISSING_MSN/);
});

test("git-proof: missionPathRepoRelative rejects outside repo", () => {
  const root = getRepoRoot();
  assert.throws(() => missionPathRepoRelative(root, "/nonexistent-outside/opengantry.md"), /outside repository/);
});

test("skill sync: manifest keys match skills/*.md", () => {
  const root = getRepoRoot();
  const m = loadManifest(root);
  const s = checkSkillManifestSync(root, m);
  assert.equal(s.ok, true, s.errors.join("\n"));
});

test("verifyTraceRows: anchor line must contain quote", () => {
  const log = "line one\nline two evidence here\n";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-trace-"));
  const p = path.join(dir, "WORKER_LOG.md");
  fs.writeFileSync(p, log, "utf8");
  const fails = verifyTraceRows(p, [
    { dodId: "1", traceQuote: "evidence here", anchor: "2", status: "PASS" },
  ]);
  assert.equal(fails.length, 0);
  const bad = verifyTraceRows(p, [
    { dodId: "1", traceQuote: "evidence here", anchor: "1", status: "PASS" },
  ]);
  assert.ok(bad.length > 0);
});

const TEACHER_EMAIL = "teacher-mini-repo@opengantry.test";
const OTHER_EMAIL = "other@opengantry.test";

function writeMiniGapmanRepo(dest: string, ogRoot: string): void {
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.mkdirSync(path.join(dest, ".gitagent", "teacher"), { recursive: true });
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "teacher", "MISSION.schema.yaml"),
    path.join(dest, ".gitagent", "teacher", "MISSION.schema.yaml"),
  );
  const manifest = {
    schema_version: "0.5.0",
    skills: {
      "ui-ralph": {
        trust_threshold: "Tier-1",
        tmvc_roots: [],
        forbidden_zones: [],
      },
    },
    path_risks: {},
    risk_keywords: [],
  };
  fs.writeFileSync(
    path.join(dest, ".gitagent", "foreman", "MANIFEST.json"),
    JSON.stringify(manifest),
    "utf8",
  );
  const missionYaml = `msn_id: MSN-0999
skill_key: ui-ralph
gate_command: "echo DONE"
gate_success_substring: "DONE"
trace_rows:
  - dod_id: "1"
    trace_quote: "evidence A"
    anchor: "1"
    status: PASS
`;
  fs.writeFileSync(path.join(dest, ".gitagent", "missions", "m.yaml"), missionYaml, "utf8");
  fs.writeFileSync(path.join(dest, "WORKER_LOG.md"), "evidence A\n", "utf8");
}

function gitInitCommit(dest: string, subject: string, email: string): void {
  execSync("git init", { cwd: dest, stdio: "pipe" });
  execSync(`git config user.email "${email}"`, { cwd: dest, stdio: "pipe" });
  execSync('git config user.name "MiniRepo"', { cwd: dest, stdio: "pipe" });
  execSync("git add -A", { cwd: dest, stdio: "pipe" });
  execSync(`git commit -m "${subject.replace(/"/g, '\\"')}"`, { cwd: dest, stdio: "pipe" });
}

/** Subject is first line; body paragraphs do not satisfy subject-line legislation checks. */
function gitInitCommitWithBody(dest: string, subject: string, body: string, email: string): void {
  execSync("git init", { cwd: dest, stdio: "pipe" });
  execSync(`git config user.email "${email}"`, { cwd: dest, stdio: "pipe" });
  execSync('git config user.name "MiniRepo"', { cwd: dest, stdio: "pipe" });
  execSync("git add -A", { cwd: dest, stdio: "pipe" });
  const r = spawnSync("git", ["-C", dest, "commit", "-m", subject, "-m", body], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(r.stderr || "git commit failed");
  }
}

function withTeacherEnv<T>(fn: () => T): T {
  const prev = process.env.GAPMAN_TEACHER_EMAILS;
  process.env.GAPMAN_TEACHER_EMAILS = TEACHER_EMAIL;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.GAPMAN_TEACHER_EMAILS;
    else process.env.GAPMAN_TEACHER_EMAILS = prev;
  }
}

test("git-proof: TEACHER_IDENTITY_UNCONFIGURED", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-gitpf-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] legislate", TEACHER_EMAIL);
  const missionAbs = path.join(dest, ".gitagent", "missions", "m.yaml");
  const prev = process.env.GAPMAN_TEACHER_EMAILS;
  delete process.env.GAPMAN_TEACHER_EMAILS;
  try {
    assert.throws(() => assertTeacherMissionProof(dest, missionAbs), /TEACHER_IDENTITY_UNCONFIGURED/);
  } finally {
    if (prev === undefined) delete process.env.GAPMAN_TEACHER_EMAILS;
    else process.env.GAPMAN_TEACHER_EMAILS = prev;
  }
});

test("git-proof: NO_MSN_COMMITS", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-gitpf-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "no msn prefix", TEACHER_EMAIL);
  const missionAbs = path.join(dest, ".gitagent", "missions", "m.yaml");
  withTeacherEnv(() => {
    assert.throws(() => assertTeacherMissionProof(dest, missionAbs), /NO_MSN_COMMITS/);
  });
});

test("git-proof: [MSN] only in commit body does not satisfy stamp", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-gitpf-body"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommitWithBody(
    dest,
    "docs: tweak readme only",
    "[MSN-0999] this MSN tag appears only in the body, not the subject",
    TEACHER_EMAIL,
  );
  const missionAbs = path.join(dest, ".gitagent", "missions", "m.yaml");
  withTeacherEnv(() => {
    assert.throws(() => assertTeacherMissionProof(dest, missionAbs), /NO_MSN_COMMITS/);
  });
});

test("git-proof: NO_TEACHER_MSN_COMMIT", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-gitpf-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] other only", OTHER_EMAIL);
  const missionAbs = path.join(dest, ".gitagent", "missions", "m.yaml");
  withTeacherEnv(() => {
    assert.throws(() => assertTeacherMissionProof(dest, missionAbs), /NO_TEACHER_MSN_COMMIT/);
  });
});

test("git-proof: accepts Teacher stamp when newer [MSN] commit is non-Teacher", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-gitpf-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] teacher", TEACHER_EMAIL);
  execSync(`git config user.email "${OTHER_EMAIL}"`, { cwd: dest, stdio: "pipe" });
  fs.writeFileSync(path.join(dest, "extra.txt"), "x", "utf8");
  execSync("git add extra.txt", { cwd: dest, stdio: "pipe" });
  execSync('git commit -m "[MSN-0999] worker follow-up"', { cwd: dest, stdio: "pipe" });
  const missionAbs = path.join(dest, ".gitagent", "missions", "m.yaml");
  withTeacherEnv(() => {
    assert.equal(assertTeacherMissionProof(dest, missionAbs), "MSN-0999");
  });
});

test("git-proof: MISSION_FILE_NOT_MODIFIED_BY_TEACHER", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-gitpf-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] teacher mission", TEACHER_EMAIL);
  fs.writeFileSync(path.join(dest, "noise.txt"), "n", "utf8");
  execSync("git add noise.txt", { cwd: dest, stdio: "pipe" });
  execSync('git commit -m "[MSN-0999] noise only"', { cwd: dest, stdio: "pipe" });
  const missionAbs = path.join(dest, ".gitagent", "missions", "m.yaml");
  withTeacherEnv(() => {
    assert.throws(
      () => assertTeacherMissionProof(dest, missionAbs),
      /MISSION_FILE_NOT_MODIFIED_BY_TEACHER/,
    );
  });
});

test("git-proof: MISSION_OUTSIDE_MISSIONS_DIR", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-gitpf-"));
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.mkdirSync(path.join(dest, ".gitagent", "teacher"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "teacher", "MISSION.schema.yaml"),
    path.join(dest, ".gitagent", "teacher", "MISSION.schema.yaml"),
  );
  const manifest = {
    schema_version: "0.5.0",
    skills: {
      "ui-ralph": {
        trust_threshold: "Tier-1",
        tmvc_roots: [],
        forbidden_zones: [],
      },
    },
    path_risks: {},
    risk_keywords: [],
  };
  fs.writeFileSync(
    path.join(dest, ".gitagent", "foreman", "MANIFEST.json"),
    JSON.stringify(manifest),
    "utf8",
  );
  const missionYaml = `msn_id: MSN-0999
skill_key: ui-ralph
gate_command: "echo DONE"
gate_success_substring: "DONE"
trace_rows: []
`;
  fs.writeFileSync(path.join(dest, "root-mission.yaml"), missionYaml, "utf8");
  gitInitCommit(dest, "[MSN-0999] bad path", TEACHER_EMAIL);
  const missionAbs = path.join(dest, "root-mission.yaml");
  withTeacherEnv(() => {
    assert.throws(() => assertTeacherMissionProof(dest, missionAbs), /MISSION_OUTSIDE_MISSIONS_DIR/);
  });
});

test("extractMsnIdFromMissionFile: YAML frontmatter on markdown", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-msn-ex-"));
  const p = path.join(dir, "m.md");
  fs.writeFileSync(p, "---\nmsn_id: MSN-0888\n---\n# body\n", "utf8");
  assert.equal(extractMsnIdFromMissionFile(p), "MSN-0888");
});

test("extractMsnIdFromMissionFile: line-start bracket id", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-msn-ex-"));
  const p = path.join(dir, "m.md");
  fs.writeFileSync(p, "[MSN-0777] Title line\nrest\n", "utf8");
  assert.equal(extractMsnIdFromMissionFile(p), "MSN-0777");
});

test("parseMissionFile: YAML mission with msnId only", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-msnid-"));
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.mkdirSync(path.join(dest, ".gitagent", "teacher"), { recursive: true });
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "teacher", "MISSION.schema.yaml"),
    path.join(dest, ".gitagent", "teacher", "MISSION.schema.yaml"),
  );
  const missionYaml = `msnId: MSN-0555
skill_key: ui-ralph
gate_command: "echo OK"
gate_success_substring: "OK"
trace_rows: []
`;
  fs.writeFileSync(path.join(dest, ".gitagent", "missions", "id.yaml"), missionYaml, "utf8");
  const parsed = parseMissionFile(dest, ".gitagent/missions/id.yaml");
  assert.equal(parsed.msnId, "MSN-0555");
});

test("runVerify: passes with Teacher git-proof in mini repo", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] legislate mission", TEACHER_EMAIL);
  const prevCwd = process.cwd();
  withTeacherEnv(() => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      runVerify({ mission: ".gitagent/missions/m.yaml", workerLog: "WORKER_LOG.md" });
      assert.equal(process.exitCode, undefined, "exitCode should not be set on success");
    } finally {
      process.chdir(prevCwd);
    }
  });
});

test("allocateNextMsnId: empty missions dir yields MSN-0000", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-msn-empty-"));
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  assert.equal(allocateNextMsnId(dest), "MSN-0000");
});

test("allocateNextMsnId: MSN-0888 in mission yields MSN-0889", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-msn-inc-"));
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, ".gitagent", "missions", "prior.yaml"),
    `msn_id: MSN-0888
skill_key: ui-ralph
gate_command: "echo OK"
gate_success_substring: "OK"
trace_rows: []
`,
    "utf8",
  );
  assert.equal(allocateNextMsnId(dest), "MSN-0889");
});

test("runtime env: resolves manifest TMVC/forbidden zones for YAML mission", () => {
  const w = loadWorkspace();
  const r = resolveRuntimeEnv(w, ".gitagent/missions/example.verify.yaml");
  assert.equal(r.skill_key, "logic-ralph");
  assert.equal(r.msn_id, "MSN-0012");
  assert.match(r.worker_log, /WORKER_LOG\.md$/);
  assert.ok(
    r.tmvc_roots_joined.includes(`${path.sep}src${path.sep}lib`),
    "absolute TMVC roots",
  );
  assert.ok(r.forbidden_zones_joined.length > 0, "non-empty forbidden_zones_joined string");
});

test("runtime env: rejects unknown manifest skill_key", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-runtime-unknown-"));
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.mkdirSync(path.join(dest, ".gitagent", "teacher"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "foreman", "MANIFEST.json"),
    path.join(dest, ".gitagent", "foreman", "MANIFEST.json"),
  );
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "teacher", "MISSION.schema.yaml"),
    path.join(dest, ".gitagent", "teacher", "MISSION.schema.yaml"),
  );
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  const missionYaml = `msn_id: MSN-0990
skill_key: not-a-manifest-skill
gate_command: "echo OK"
gate_success_substring: "OK"
trace_rows: []
`;
  fs.writeFileSync(path.join(dest, ".gitagent", "missions", "m.yaml"), missionYaml, "utf8");
  const manifest = loadManifest(dest);
  assert.throws(
    () => resolveRuntimeEnv({ root: dest, manifest }, ".gitagent/missions/m.yaml"),
    /manifest has no skill/,
  );
});

test("legislate: writes next YAML mission under .gitagent/missions/", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-leg-"));
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "foreman", "MANIFEST.json"),
    path.join(dest, ".gitagent", "foreman", "MANIFEST.json"),
  );
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, ".gitagent", "missions", "prior.yaml"),
    `msn_id: MSN-0988
skill_key: ui-ralph
gate_command: "echo OK"
gate_success_substring: "OK"
trace_rows: []
`,
    "utf8",
  );
  execSync("git init", { cwd: dest, stdio: "pipe" });

  const prevCwd = process.cwd();
  process.chdir(dest);
  try {
    process.exitCode = undefined;
    runLegislate({
      intent: "Add button hover state ui-ralph",
      skillKey: "ui-ralph",
    });
    assert.equal(process.exitCode, undefined);
    const files = fs.readdirSync(path.join(dest, ".gitagent", "missions"));
    assert.ok(files.some((f) => f.startsWith("MSN-0989.") && f.endsWith(".yaml")));
    const created = fs
      .readdirSync(path.join(dest, ".gitagent", "missions"))
      .find((f) => f.startsWith("MSN-0989.") && f.endsWith(".yaml"))!;
    const body = fs.readFileSync(path.join(dest, ".gitagent", "missions", created), "utf8");
    assert.ok(body.includes("msn_id: MSN-0989") || body.includes("MSN-0989"));
    assert.ok(body.includes("skill_key: ui-ralph"));
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
  }
});

test("legislate: triage escalation exits 2 without --skill-key", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-leg-ex-"));
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "foreman", "MANIFEST.json"),
    path.join(dest, ".gitagent", "foreman", "MANIFEST.json"),
  );
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  execSync("git init", { cwd: dest, stdio: "pipe" });

  const prevCwd = process.cwd();
  process.chdir(dest);
  try {
    process.exitCode = undefined;
    runLegislate({ intent: "refactor all security-critical paths everywhere" });
    assert.equal(process.exitCode, 2);
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
  }
});

function writeRuntimeExecRepo(
  dest: string,
  ogRoot: string,
  forbiddenZones: string[],
): void {
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.mkdirSync(path.join(dest, ".gitagent", "teacher"), { recursive: true });
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "teacher", "MISSION.schema.yaml"),
    path.join(dest, ".gitagent", "teacher", "MISSION.schema.yaml"),
  );
  const manifest = {
    schema_version: "0.5.0",
    skills: {
      "ui-ralph": {
        trust_threshold: "Tier-1",
        tmvc_roots: ["src/components/"],
        forbidden_zones: forbiddenZones,
      },
    },
    path_risks: {},
    risk_keywords: [],
  };
  fs.writeFileSync(
    path.join(dest, ".gitagent", "foreman", "MANIFEST.json"),
    JSON.stringify(manifest),
    "utf8",
  );
  const missionYaml = `msn_id: MSN-0910
skill_key: ui-ralph
gate_command: "echo OK"
gate_success_substring: "OK"
trace_rows: []
`;
  fs.writeFileSync(path.join(dest, ".gitagent", "missions", "runtime.yaml"), missionYaml, "utf8");
}

test("runtime exec: captures stream telemetry and succeeds", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-runtime-exec-ok-"));
  writeRuntimeExecRepo(dest, ogRoot, []);
  const manifest = loadManifest(dest);
  const result = await runRuntimeExec(
    { root: dest, manifest },
    {
      mission: ".gitagent/missions/runtime.yaml",
      workerCommand: ["node", "-e", "process.stdout.write('OUT'); process.stderr.write('ERR');"],
      streamOutput: false,
    },
  );
  assert.equal(result.status, "success");
  assert.equal(result.exitCode, 0);
  assert.equal(fs.existsSync(path.join(dest, "WORKER_LOG.md")), true);
  const body = fs.readFileSync(path.join(dest, "WORKER_LOG.md"), "utf8");
  assert.match(body, /"type":"flight_start"/);
  assert.match(body, /"type":"stream"/);
  assert.match(body, /"type":"flight_end"/);
});

test("runtime exec: forbidden-zone write returns violation code", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-runtime-exec-fz-"));
  fs.mkdirSync(path.join(dest, "forbidden"), { recursive: true });
  writeRuntimeExecRepo(dest, ogRoot, ["forbidden/"]);
  const manifest = loadManifest(dest);
  const js = "require('node:fs').writeFileSync('forbidden/pwn.txt','x')";
  const result = await runRuntimeExec(
    { root: dest, manifest },
    {
      mission: ".gitagent/missions/runtime.yaml",
      workerCommand: ["node", "-e", js],
      streamOutput: false,
    },
  );
  assert.equal(result.status, "forbidden_zone_violation");
  assert.equal(result.exitCode, 3);
  assert.ok(result.violations.some((v) => v.path === "forbidden/pwn.txt"));
  const body = fs.readFileSync(path.join(dest, "WORKER_LOG.md"), "utf8");
  assert.match(body, /"type":"forbidden_scan"/);
});
