// DoD 4 (MSN-0252): the packed tarball behaves like `gantry cage`: a tampered .env exits 3 and is restored,
// a clean run returns the command's own exit code, and the session push guard points at this package's bin.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { npx, npxCage, packOnce, run, tmpDir } from "./helpers.mjs";

function scratchRepo() {
  const dir = tmpDir("opengantry-cage-parity-");
  const git = (args) => execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q"]);
  git(["config", "user.email", "cage@test"]);
  git(["config", "user.name", "cage"]);
  fs.writeFileSync(path.join(dir, ".env"), "SECRET=baseline\n");
  git(["add", ".env"]);
  git(["commit", "-qm", "baseline"]);
  return dir;
}

const tamper = `require('fs').writeFileSync('.env', 'SECRET=tampered\\n')`;

test("tampering .env inside the cage exits 3 and restores the file", { timeout: 120_000 }, () => {
  const cwd = scratchRepo();
  const r = npxCage(packOnce(), ["--", "node", "-e", tamper], { cwd });
  assert.equal(r.status, 3, `stderr: ${r.stderr}`);
  assert.equal(fs.readFileSync(path.join(cwd, ".env"), "utf8"), "SECRET=baseline\n");
  assert.match(r.stderr, /reverted\s+modified \.env \(secrets\)/);
});

test("a clean command keeps its own exit code", { timeout: 120_000 }, () => {
  const cwd = scratchRepo();
  const r = npxCage(packOnce(), ["--", "node", "-e", "process.exit(7)"], { cwd });
  assert.equal(r.status, 7, `stderr: ${r.stderr}`);
});

test("the session pre-push hook resolves the guard to this package's dist/cli/index.js", { timeout: 120_000 }, () => {
  const cwd = scratchRepo();
  const probe = [
    "const fs=require('fs');const {execSync}=require('child_process');",
    "const hooks=execSync('git rev-parse --path-format=absolute --git-path hooks').toString().trim();",
    "const s=fs.readFileSync(require('path').join(hooks,'pre-push'),'utf8');",
    "const m=s.match(/'([^']*index\\.js)' cage-guard pre-push/);",
    "process.stdout.write(JSON.stringify({entry:m&&m[1],exists:!!(m&&fs.existsSync(m[1]))}));",
  ].join("");
  const r = npxCage(packOnce(), ["--", "node", "-e", probe], { cwd });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.ok(out.entry && out.entry.replace(/\\/g, "/").endsWith("/dist/cli/index.js"), `guard entry: ${out.entry}`);
  assert.equal(out.exists, true, "guard entry exists on disk while the session runs");
});

test("npx <tarball> with no -p runs the package's single bin, gantry-cage (MSN-0258 DoD 3)", { timeout: 120_000 }, () => {
  const cwd = tmpDir("opengantry-cage-npx-");
  // A bare path as npx's first argument is executed as a program; `file:` makes it a package spec,
  // like `npx @jeger-ai/opengantry-cage` resolves the registry package.
  const spec = `file:${packOnce()}`;
  const version = run(npx, ["-y", spec, "--version"], { cwd });
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);
  const help = run(npx, ["-y", spec, "--help"], { cwd });
  assert.match(help.stdout, /^Usage: gantry-cage \[options\] <command\.\.\.>/m);
});

test("--lock-deps restores a lockfile and a dependency manifest, like gantry cage --lock-deps (MSN-0275 DoD 2, 5)", { timeout: 120_000 }, () => {
  const cwd = scratchRepo();
  fs.writeFileSync(path.join(cwd, "package-lock.json"), "{}\n");
  fs.writeFileSync(path.join(cwd, "package.json"), '{"name":"fixture"}\n');
  const addDep = [
    "const fs=require('fs');",
    "fs.writeFileSync('package-lock.json','{\"typosquat\":1}\\n');",
    "fs.writeFileSync('package.json','{\"name\":\"fixture\",\"dependencies\":{\"reqeusts\":\"1.0.0\"}}\\n');",
  ].join("");
  const unfrozen = npxCage(packOnce(), ["--", "node", "-e", addDep], { cwd });
  assert.equal(unfrozen.status, 0, `stderr: ${unfrozen.stderr}`);
  assert.match(unfrozen.stderr, /kept\s+modified package-lock\.json \(lockfile\)/);
  fs.writeFileSync(path.join(cwd, "package-lock.json"), "{}\n");
  fs.writeFileSync(path.join(cwd, "package.json"), '{"name":"fixture"}\n');

  const r = npxCage(packOnce(), ["--lock-deps", "--", "node", "-e", addDep], { cwd });
  assert.equal(r.status, 3, `stderr: ${r.stderr}`);
  assert.match(r.stderr, /\(dependencies frozen\)/);
  assert.match(r.stderr, /reverted\s+modified package-lock\.json \(lockfile\)/);
  assert.match(r.stderr, /reverted\s+modified package\.json \(dependency_manifest\)/);
  assert.equal(fs.readFileSync(path.join(cwd, "package-lock.json"), "utf8"), "{}\n");
  assert.equal(fs.readFileSync(path.join(cwd, "package.json"), "utf8"), '{"name":"fixture"}\n');
});

test("--allow-only restores a tracked file outside the scope and keeps edits inside it (MSN-0276 DoD 2, 6)", { timeout: 120_000 }, () => {
  const cwd = scratchRepo();
  fs.mkdirSync(path.join(cwd, "src", "billing"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "src", "billing", "invoice.js"), "1\n");
  fs.writeFileSync(path.join(cwd, "README.md"), "readme\n");
  execFileSync("git", ["add", "-A"], { cwd });
  execFileSync("git", ["commit", "-qm", "files"], { cwd });
  const wander = "const fs=require('fs');fs.writeFileSync('src/billing/invoice.js','2\\n');fs.writeFileSync('README.md','wander\\n');";
  const r = npxCage(packOnce(), ["--allow-only", "src/billing", "--", "node", "-e", wander], { cwd });
  assert.equal(r.status, 3, `stderr: ${r.stderr}`);
  assert.match(r.stderr, /\(scope: src\/billing\)/);
  assert.match(r.stderr, /reverted\s+modified README\.md \(out_of_scope\)/);
  assert.equal(fs.readFileSync(path.join(cwd, "README.md"), "utf8"), "readme\n");
  assert.equal(fs.readFileSync(path.join(cwd, "src", "billing", "invoice.js"), "utf8"), "2\n");
});
