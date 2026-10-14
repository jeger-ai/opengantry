// DoD 4 (MSN-0252): the packed tarball behaves like `gantry cage`: a tampered .env exits 3 and is restored,
// a clean run returns the command's own exit code, and the session push guard points at this package's bin.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { npxCage, packOnce, tmpDir } from "./helpers.mjs";

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
