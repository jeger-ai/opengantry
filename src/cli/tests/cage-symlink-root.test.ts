import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gitChildEnv } from "../lib/git/git.js";
import { resolveCageRoot, runCage } from "../lib/cage/cage-run.js";
import { buildCagePlan, classifyCagePath } from "../lib/cage/cage-rules.js";
import { suggestCageRules } from "../lib/cage/cage-suggest.js";

/**
 * MSN-0265: a cage root reached through a symlink, as macOS reaches every temp dir (/var -> /private/var).
 * git reports resolved paths, so the cage must resolve its root too or the git control targets fall outside
 * plan.root and lose their rule. Runs on any POSIX host by building the symlink itself.
 */

const SECRET = "TOKEN=SECRET-MARKER-symlink";

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, env: gitChildEnv(), encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
}

/** A git repo at `real` and a directory symlink `link` pointing at it; callers only ever use `link`. */
function linkedRepo(prefix: string, hooksPath: boolean): { real: string; link: string } {
  const real = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}real-`)));
  const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}link-`)), "repo");
  fs.symlinkSync(real, link, "dir");
  git(real, ["init", "-q"]);
  fs.mkdirSync(path.join(real, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(real, ".github", "workflows", "ci.yml"), "on: push\n");
  fs.writeFileSync(path.join(real, ".env"), `${SECRET}\n`);
  fs.mkdirSync(path.join(real, ".githooks"));
  fs.writeFileSync(path.join(real, ".githooks", "pre-push"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  if (hooksPath) git(real, ["config", "core.hooksPath", ".githooks"]);
  assert.notEqual(link, real, "the fixture reaches the repo through a symlink");
  return { real, link };
}

test("cage symlink root: the plan resolves the root and every target lies under it (MSN-0265 DoD 1, DoD 2)", () => {
  const { real, link } = linkedRepo("og-cage-symlink-plan-", true);
  const plan = buildCagePlan(link);
  assert.equal(plan.root, real, "plan.root is the resolved path");
  for (const t of plan.targets) {
    assert.ok(t.abs === real || t.abs.startsWith(`${real}${path.sep}`), `${t.rule} target ${t.abs} lies under the root`);
  }
  for (const rel of [".git/config", ".git/hooks/pre-commit", ".githooks/pre-push"]) {
    assert.equal(classifyCagePath(plan, rel)?.rule, "git_control", `${rel} keeps its git_control rule`);
  }
  assert.equal(classifyCagePath(plan, ".env")?.mode, "revert");
  assert.equal(resolveCageRoot(link), real, "resolveCageRoot resolves a symlinked cwd");
});

test("cage symlink root: resolveCageRoot resolves a symlinked directory outside git too (MSN-0265 DoD 1)", () => {
  const real = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-symlink-nogit-real-")));
  const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-symlink-nogit-link-")), "dir");
  fs.symlinkSync(real, link, "dir");
  assert.equal(resolveCageRoot(link), real);
  assert.equal(buildCagePlan(link).root, real);
});

test("cage symlink root: suggest skips the active hooks path and still proposes an inactive one (MSN-0265 DoD 2)", () => {
  const active = linkedRepo("og-cage-symlink-suggest-on-", true);
  assert.ok(
    !suggestCageRules(active.link).suggestions.some((s) => s.value === ".githooks"),
    "the active hooks path is already git_control",
  );
  const inactive = linkedRepo("og-cage-symlink-suggest-off-", false);
  assert.ok(
    suggestCageRules(inactive.link).suggestions.some((s) => s.value === ".githooks" && s.category === "git_hooks"),
    "an inactive hooks directory is still proposed",
  );
});

test("cage symlink root: a caged command run through the symlink has .git/hooks and .env restored (MSN-0265 DoD 2)", async () => {
  const { real, link } = linkedRepo("og-cage-symlink-run-", false);
  const hook = path.join(real, ".git", "hooks", "pre-commit");
  fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const report = await runCage({
    cwd: link,
    watch: false,
    command: [
      process.execPath,
      "-e",
      `const fs = require("fs");
       fs.writeFileSync(".git/hooks/pre-commit", "#!/bin/sh\\nexit 0\\n");
       fs.writeFileSync(".env", "TOKEN=stolen\\n");`,
    ],
  });
  assert.equal(report.exit_code, 3);
  const byPath = new Map(report.changes.map((c) => [c.path, c]));
  assert.equal(byPath.get(".git/hooks/pre-commit")?.rule, "git_control");
  assert.equal(byPath.get(".git/hooks/pre-commit")?.outcome, "reverted");
  assert.equal(byPath.get(".env")?.outcome, "reverted");
  assert.equal(fs.readFileSync(hook, "utf8"), "#!/bin/sh\nexit 1\n");
  assert.equal(fs.readFileSync(path.join(real, ".env"), "utf8"), `${SECRET}\n`);
});
