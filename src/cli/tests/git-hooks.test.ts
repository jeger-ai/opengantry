import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { AIDER_TMVC_SCOPE_REL, ensureAiderConfRead, writeAiderTmvcScope } from "../lib/aider-scope.js";
import { getRepoRoot } from "../lib/git/git.js";
import {
  TMVC_GUARD_STRICT_KEY,
  installTmvcStrictHook,
  readHooksStatus,
  uninstallTmvcStrictHook,
} from "../lib/git/git-hooks.js";

function initGitRepo(dest: string): void {
  execSync("git init", { cwd: dest, stdio: "pipe" });
  execSync('git config user.email "test@example.com"', { cwd: dest, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dest, stdio: "pipe" });
  execSync("git config commit.gpgsign false", { cwd: dest, stdio: "pipe" });
}

function localConfig(dest: string, key: string): string {
  const result = spawnSync("git", ["config", "--local", "--get", key], { cwd: dest, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function placeTrackedHook(dest: string): void {
  const hookDir = path.join(dest, ".githooks");
  fs.mkdirSync(hookDir, { recursive: true });
  const hook = path.join(hookDir, "pre-commit");
  fs.copyFileSync(path.join(getRepoRoot(), ".githooks", "pre-commit"), hook);
  fs.chmodSync(hook, 0o755);
  const scripts = path.join(dest, "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(
    path.join(scripts, "gxt-resolve-mission.sh"),
    "#!/bin/sh\nprintf '%s\\n' .gitagent/missions/MSN-0001.example.yaml\n",
    { mode: 0o755 },
  );
}

function placeStubGantry(binDir: string): void {
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    path.join(binDir, "gantry"),
    [
      "#!/bin/sh",
      'printf "%s\\n" "$*" >> "$GANTRY_STUB_LOG"',
      'exit "${GANTRY_STUB_EXIT:-0}"',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
}

function commitNote(
  dest: string,
  binDir: string,
  logFile: string,
  stubExit: string,
  noVerify: boolean,
): number {
  fs.writeFileSync(path.join(dest, "note.txt"), `note ${stubExit} ${String(noVerify)}\n`, "utf8");
  execSync("git add note.txt", { cwd: dest, stdio: "pipe" });
  const args = ["commit", "-m", "test note"];
  if (noVerify) args.push("--no-verify");
  const result = spawnSync("git", args, {
    cwd: dest,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      GANTRY_STUB_LOG: logFile,
      GANTRY_STUB_EXIT: stubExit,
    },
  });
  return result.status ?? 1;
}

test("hooks install is idempotent, uninstall clears the key, and a foreign hooks path is refused", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-hooks-"));
  initGitRepo(dest);
  placeTrackedHook(dest);

  const first = installTmvcStrictHook(dest);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.alreadyInstalled, false);
  assert.equal(localConfig(dest, "core.hooksPath"), ".githooks");
  assert.equal(localConfig(dest, TMVC_GUARD_STRICT_KEY), "true");

  const second = installTmvcStrictHook(dest);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.alreadyInstalled, true);
  assert.equal(readHooksStatus(dest).strictArmed, true);

  assert.equal(uninstallTmvcStrictHook(dest).removed, true);
  assert.equal(uninstallTmvcStrictHook(dest).removed, false);
  assert.equal(localConfig(dest, TMVC_GUARD_STRICT_KEY), "");
  assert.equal(localConfig(dest, "core.hooksPath"), ".githooks");
  assert.equal(readHooksStatus(dest).strictArmed, false);

  execSync("git config core.hooksPath .custom-hooks", { cwd: dest, stdio: "pipe" });
  const refused = installTmvcStrictHook(dest);
  assert.equal(refused.ok, false);
  assert.equal(localConfig(dest, TMVC_GUARD_STRICT_KEY), "");
});

test("hooks install reports a missing tracked pre-commit", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-hooks-missing-"));
  initGitRepo(dest);
  const result = installTmvcStrictHook(dest);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.message, /missing \.githooks\/pre-commit/);
});

test("strict pre-commit blocks git commit, --no-verify bypasses, and a passing guard allows the commit", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-hooks-commit-"));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "og-hooks-bin-"));
  const logFile = path.join(dest, "stub.log");
  initGitRepo(dest);
  placeTrackedHook(dest);
  placeStubGantry(binDir);
  const installed = installTmvcStrictHook(dest);
  assert.equal(installed.ok, true);

  fs.writeFileSync(logFile, "", "utf8");
  assert.notEqual(commitNote(dest, binDir, logFile, "1", false), 0);
  assert.match(fs.readFileSync(logFile, "utf8"), /--strict/);

  fs.writeFileSync(logFile, "", "utf8");
  assert.equal(commitNote(dest, binDir, logFile, "1", true), 0);
  assert.equal(fs.readFileSync(logFile, "utf8"), "");

  fs.writeFileSync(logFile, "", "utf8");
  assert.equal(commitNote(dest, binDir, logFile, "0", false), 0);
  assert.match(fs.readFileSync(logFile, "utf8"), /--strict/);
});

test("aider scope file lists roots and patches read: once", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-aider-scope-"));
  const conf = path.join(dest, ".aider.conf.yml");
  fs.writeFileSync(conf, "read:\n  - AGENTS.md\n", "utf8");

  const first = writeAiderTmvcScope(dest, ["src/cli/", "package.json"]);
  assert.equal(first.scopeFile, AIDER_TMVC_SCOPE_REL);
  assert.equal(first.confPatched, true);
  const scope = fs.readFileSync(path.join(dest, AIDER_TMVC_SCOPE_REL), "utf8");
  assert.match(scope, /src\/cli\//);
  assert.match(scope, /package\.json/);
  assert.match(scope, /Do not edit paths outside these roots/);

  const second = writeAiderTmvcScope(dest, ["src/cli/", "package.json"]);
  assert.equal(second.confPatched, false);
  const body = fs.readFileSync(conf, "utf8");
  assert.equal(body.split(AIDER_TMVC_SCOPE_REL).length - 1, 1);

  const untouched = ensureAiderConfRead("read: AGENTS.md\n", AIDER_TMVC_SCOPE_REL);
  assert.equal(untouched.changed, false);
  assert.equal(untouched.body, "read: AGENTS.md\n");
});
