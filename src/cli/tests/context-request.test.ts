import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  classifyRepoRelativePath,
  isGovernanceTransportPath,
  isPathUnderRoot,
} from "../lib/tmvc-path.js";
import {
  appendContextRequest,
  formatContextRequestLine,
  stageExecutorLogIfRequested,
} from "../lib/context-request.js";
import { gitReadStagedBlob, gitStagedNameOnly } from "../lib/git-staged.js";
import {
  evaluateStagedTmvcGuard,
  formatStagedTmvcAdvisory,
} from "../lib/staged-tmvc-guard.js";
import { runContextRequest } from "../commands/context-request.js";
import { runTmvcGuard } from "../commands/tmvc-guard.js";
import { loadManifest } from "../lib/manifest.js";
import { copyMissionSchema, writeManifest } from "./test-fixtures.js";

function initGitRepo(dest: string): void {
  execSync("git init", { cwd: dest, stdio: "pipe" });
  execSync('git config user.email "test@example.com"', { cwd: dest, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dest, stdio: "pipe" });
}

function writeWave3Repo(dest: string, ogRoot: string): { missionRel: string } {
  copyMissionSchema(path.join(ogRoot, ".gitagent", "planner"), path.join(dest, ".gitagent", "planner"));
  writeManifest(dest, {
    gantry: {
      trust_threshold: "Tier-2",
      tmvc_roots: ["src/cli/"],
      forbidden_zones: [".gitagent/foreman/"],
    },
  });
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  const missionRel = ".gitagent/missions/wave3.yaml";
  fs.writeFileSync(
    path.join(dest, missionRel),
    `msn_id: MSN-0801
skill_key: gantry
gate_command: echo OK
gate_success_substring: OK
trace_rows: []
`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(dest, ".gitagent", "missions", ".active-mission"),
    `${missionRel}\n`,
    "utf8",
  );
  fs.mkdirSync(path.join(dest, "src", "cli"), { recursive: true });
  return { missionRel };
}

test("tmvc-path: governance transport passthrough", () => {
  assert.equal(isGovernanceTransportPath("EXECUTOR_LOG.md"), true);
  assert.equal(isGovernanceTransportPath(".gitagent/missions/.active-mission"), true);
  assert.equal(isGovernanceTransportPath("src/cli/foo.ts"), false);
});

test("tmvc-path: classify inside, outside, forbidden", () => {
  const roots = ["src/cli/"];
  const fz = [".gitagent/foreman/"];
  assert.equal(classifyRepoRelativePath("src/cli/lib/foo.ts", roots, fz), "inside_tmvc");
  assert.equal(classifyRepoRelativePath("README.md", roots, fz), "outside_tmvc");
  assert.equal(
    classifyRepoRelativePath(".gitagent/foreman/MANIFEST.json", roots, fz),
    "forbidden_zone",
  );
  assert.equal(classifyRepoRelativePath("EXECUTOR_LOG.md", roots, fz), "governance_transport");
});

test("tmvc-path: isPathUnderRoot", () => {
  assert.equal(isPathUnderRoot("src/cli/lib/x.ts", "src/cli/"), true);
  assert.equal(isPathUnderRoot("src/core/x.ts", "src/cli/"), false);
});

test("context-request: format and append scaffold", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ctx-req-"));
  const logPath = path.join(dest, "EXECUTOR_LOG.md");
  const line = formatContextRequestLine({
    status: "PENDING",
    paths: ["docs/FOO.md"],
    reason: "doc sync",
    proposed: ["docs/FOO.md"],
    msnId: "MSN-0801",
  });
  assert.match(line, /Context Request PENDING/);
  assert.match(line, /`docs\/FOO\.md`/);
  appendContextRequest({
    executorLogPath: logPath,
    entry: { status: "PENDING", paths: ["docs/FOO.md"], reason: "doc sync" },
  });
  const body = fs.readFileSync(logPath, "utf8");
  assert.match(body, /Context Request PENDING/);
});

test("git-staged: index-fidelity under working-tree divergence", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-git-staged-"));
  initGitRepo(dest);
  const fileRel = "src/cli/foo.ts";
  fs.mkdirSync(path.join(dest, "src", "cli"), { recursive: true });
  const fileAbs = path.join(dest, fileRel);
  fs.writeFileSync(fileAbs, "export const clean = true;\n", "utf8");
  execSync("git add .", { cwd: dest, stdio: "pipe" });
  fs.writeFileSync(fileAbs, "import banned from '../core/evil';\n", "utf8");

  const staged = gitReadStagedBlob(dest, fileRel);
  assert.equal(staged.ok, true);
  if (staged.ok) {
    assert.match(staged.content.toString("utf8"), /clean = true/);
    assert.doesNotMatch(staged.content.toString("utf8"), /evil/);
  }
});

test("staged-tmvc-guard: governance files never violate", () => {
  const ogRoot = process.cwd();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-guard-gov-"));
  initGitRepo(dest);
  writeWave3Repo(dest, ogRoot);
  fs.writeFileSync(path.join(dest, "EXECUTOR_LOG.md"), "# EXECUTOR_LOG\n", "utf8");
  fs.writeFileSync(path.join(dest, "README.md"), "# readme\n", "utf8");
  execSync("git add EXECUTOR_LOG.md README.md", { cwd: dest, stdio: "pipe" });

  const manifest = loadManifest(dest);
  const result = evaluateStagedTmvcGuard({
    repoRoot: dest,
    manifest,
    skillKey: "gantry",
  });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0]!.path, "README.md");
  assert.equal(gitStagedNameOnly(dest).length, 2);
});

test("staged-tmvc-guard: advisory formatting", () => {
  const lines = formatStagedTmvcAdvisory({
    ok: false,
    skipped: false,
    violations: [{ path: "README.md", classification: "outside_tmvc" }],
    stagedPaths: ["README.md"],
    tmvcRoots: ["src/cli/"],
    forbiddenZones: [],
  });
  assert.match(lines.join("\n"), /OUTSIDE_TMVC/);
});

test("runTmvcGuard: advisory exits 0 with stderr warnings", () => {
  const ogRoot = process.cwd();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-guard-cli-"));
  initGitRepo(dest);
  writeWave3Repo(dest, ogRoot);
  fs.writeFileSync(path.join(dest, "README.md"), "# x\n", "utf8");
  execSync("git add README.md", { cwd: dest, stdio: "pipe" });

  const prevCwd = process.cwd();
  const chunks: string[] = [];
  const origErr = console.error;
  console.error = (...args: unknown[]) => {
    chunks.push(args.map(String).join(" "));
  };
  process.chdir(dest);
  process.exitCode = undefined;
  try {
    runTmvcGuard({ mission: ".gitagent/missions/wave3.yaml" });
    assert.equal(process.exitCode, undefined);
    const errText = chunks.join("\n");
    assert.match(errText, /tmvc guard/);
  } finally {
    console.error = origErr;
    process.chdir(prevCwd);
    process.exitCode = undefined;
  }
});

test("runTmvcGuard: strict mode blocks", () => {
  const ogRoot = process.cwd();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-guard-strict-"));
  initGitRepo(dest);
  writeWave3Repo(dest, ogRoot);
  fs.writeFileSync(path.join(dest, "README.md"), "# x\n", "utf8");
  execSync("git add README.md", { cwd: dest, stdio: "pipe" });

  const prevCwd = process.cwd();
  process.chdir(dest);
  process.exitCode = undefined;
  try {
    runTmvcGuard({ mission: ".gitagent/missions/wave3.yaml", strict: true });
    assert.equal(process.exitCode, 1);
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
  }
});

test("runTmvcGuard: no mission skips with warning", () => {
  const ogRoot = process.cwd();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-guard-skip-"));
  initGitRepo(dest);
  writeWave3Repo(dest, ogRoot);
  fs.unlinkSync(path.join(dest, ".gitagent", "missions", ".active-mission"));

  const prevCwd = process.cwd();
  const chunks: string[] = [];
  const origErr = console.error;
  console.error = (...args: unknown[]) => {
    chunks.push(args.map(String).join(" "));
  };
  process.chdir(dest);
  process.exitCode = undefined;
  try {
    runTmvcGuard({});
    assert.equal(process.exitCode, undefined);
    assert.match(chunks.join("\n"), /skipping/);
  } finally {
    console.error = origErr;
    process.chdir(prevCwd);
    process.exitCode = undefined;
  }
});

test("runContextRequest: requires reason and mission", () => {
  const ogRoot = process.cwd();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ctx-cli-"));
  initGitRepo(dest);
  writeWave3Repo(dest, ogRoot);

  const prevCwd = process.cwd();
  process.chdir(dest);
  process.exitCode = undefined;
  try {
    runContextRequest({ paths: ["README.md"], reason: "" });
    assert.equal(process.exitCode, 2);
    process.exitCode = undefined;
    fs.unlinkSync(path.join(dest, ".gitagent", "missions", ".active-mission"));
    runContextRequest({ paths: ["README.md"], reason: "need docs" });
    assert.equal(process.exitCode, 2);
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
  }
});

test("runContextRequest: --stage-worker-log stages only when opted in", () => {
  const ogRoot = process.cwd();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ctx-stage-"));
  initGitRepo(dest);
  writeWave3Repo(dest, ogRoot);

  const prevCwd = process.cwd();
  process.chdir(dest);
  process.exitCode = undefined;
  try {
    runContextRequest({
      paths: ["README.md"],
      reason: "doc update",
      mission: ".gitagent/missions/wave3.yaml",
    });
    assert.equal(process.exitCode, undefined);
    const stagedDefault = execSync("git diff --cached --name-only", {
      cwd: dest,
      encoding: "utf8",
    }).trim();
    assert.equal(stagedDefault, "");

    runContextRequest({
      paths: ["docs/X.md"],
      reason: "more docs",
      mission: ".gitagent/missions/wave3.yaml",
      stageExecutorLog: true,
    });
    const stagedOptIn = execSync("git diff --cached --name-only", {
      cwd: dest,
      encoding: "utf8",
    }).trim();
    assert.equal(stagedOptIn, "EXECUTOR_LOG.md");
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
  }
});

test("stageExecutorLogIfRequested: no stage by default", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ctx-nostage-"));
  initGitRepo(dest);
  const logPath = path.join(dest, "EXECUTOR_LOG.md");
  fs.writeFileSync(logPath, "# log\n", "utf8");
  const r = stageExecutorLogIfRequested(dest, logPath, false);
  assert.equal(r.staged, false);
});
