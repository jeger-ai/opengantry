import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getRepoRoot } from "../lib/git.js";
import {
  commitSubjectHasMsnPrefix,
  assertTeacherMissionProof,
  missionPathRepoRelative,
  ENV_MSN_SCAN_DEPTH,
  resolveMsnScanDepth,
} from "../lib/git-proof.js";
import { GapmanUserError } from "../lib/errors.js";
import { writeMiniGapmanRepo, gitInitCommit, gitInitCommitWithBody } from "./test-fixtures.js";
import { execSync } from "node:child_process";
import { TEACHER_EMAIL, OTHER_EMAIL, withTeacherEnv } from "./test-shared.js";

test("commitSubjectHasMsnPrefix: requires tag on subject line", () => {
  assert.equal(commitSubjectHasMsnPrefix("[MSN-0999] legislate", "MSN-0999"), true);
  assert.equal(commitSubjectHasMsnPrefix("  [MSN-0999] legislate", "MSN-0999"), true);
  assert.equal(commitSubjectHasMsnPrefix("init only", "MSN-0999"), false);
  assert.equal(commitSubjectHasMsnPrefix("[MSN-0001] x", "MSN-0999"), false);
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
  assert.throws(
    () => assertTeacherMissionProof(dest, missionAbs),
    (e: unknown) => {
      assert.ok(e instanceof GapmanUserError);
      assert.match(String(e.message), /MISSION_MISSING_MSN/);
      assert.ok(e.hint?.includes("example.verify.yaml"));
      return true;
    },
  );
});


test("git-proof: missionPathRepoRelative rejects outside repo", () => {
  const root = getRepoRoot();
  assert.throws(() => missionPathRepoRelative(root, "/nonexistent-outside/opengantry.md"), /outside repository/);
});


test("git-proof: TEACHER_IDENTITY_UNCONFIGURED", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-gitpf-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] legislate", TEACHER_EMAIL);
  execSync("git config --unset user.email", { cwd: dest, stdio: "pipe" });
  execSync("git config --unset user.name", { cwd: dest, stdio: "pipe" });
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


test("resolveMsnScanDepth: explicit option overrides env and default", () => {
  const prev = process.env[ENV_MSN_SCAN_DEPTH];
  process.env[ENV_MSN_SCAN_DEPTH] = "500";
  try {
    assert.equal(resolveMsnScanDepth(50), 50);
    assert.equal(resolveMsnScanDepth(undefined), 500);
  } finally {
    if (prev === undefined) delete process.env[ENV_MSN_SCAN_DEPTH];
    else process.env[ENV_MSN_SCAN_DEPTH] = prev;
  }
});


test("git-proof: scanDepth option reaches Teacher stamp beyond default window", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-gitpf-depth-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] teacher legislate", TEACHER_EMAIL);
  for (let i = 0; i < 5; i++) {
    fs.writeFileSync(path.join(dest, `layer-${i}.txt`), String(i), "utf8");
    execSync(`git add layer-${i}.txt`, { cwd: dest, stdio: "pipe" });
    execSync(`git commit -m "chore: filler ${i}"`, { cwd: dest, stdio: "pipe" });
  }
  const missionAbs = path.join(dest, ".gitagent", "missions", "m.yaml");
  withTeacherEnv(() => {
    assert.throws(
      () => assertTeacherMissionProof(dest, missionAbs, { scanDepth: 1 }),
      /NO_MSN_COMMITS/,
    );
    assert.equal(assertTeacherMissionProof(dest, missionAbs, { scanDepth: 10 }), "MSN-0999");
  });
});


test("git-proof: GXT_MSN_SCAN_DEPTH env reaches Teacher stamp", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-gitpf-env-depth-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] teacher legislate", TEACHER_EMAIL);
  for (let i = 0; i < 5; i++) {
    fs.writeFileSync(path.join(dest, `env-layer-${i}.txt`), String(i), "utf8");
    execSync(`git add env-layer-${i}.txt`, { cwd: dest, stdio: "pipe" });
    execSync(`git commit -m "chore: env filler ${i}"`, { cwd: dest, stdio: "pipe" });
  }
  const missionAbs = path.join(dest, ".gitagent", "missions", "m.yaml");
  const prev = process.env[ENV_MSN_SCAN_DEPTH];
  process.env[ENV_MSN_SCAN_DEPTH] = "1";
  try {
    withTeacherEnv(() => {
      assert.throws(() => assertTeacherMissionProof(dest, missionAbs), /NO_MSN_COMMITS/);
    });
    process.env[ENV_MSN_SCAN_DEPTH] = "10";
    withTeacherEnv(() => {
      assert.equal(assertTeacherMissionProof(dest, missionAbs), "MSN-0999");
    });
  } finally {
    if (prev === undefined) delete process.env[ENV_MSN_SCAN_DEPTH];
    else process.env[ENV_MSN_SCAN_DEPTH] = prev;
  }
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
      "ui": {
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
skill_key: ui
gate_command: echo DONE
gate_success_substring: DONE
trace_rows: []
`;
  fs.writeFileSync(path.join(dest, "root-mission.yaml"), missionYaml, "utf8");
  gitInitCommit(dest, "[MSN-0999] bad path", TEACHER_EMAIL);
  const missionAbs = path.join(dest, "root-mission.yaml");
  withTeacherEnv(() => {
    assert.throws(() => assertTeacherMissionProof(dest, missionAbs), /MISSION_OUTSIDE_MISSIONS_DIR/);
  });
});

