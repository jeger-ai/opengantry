import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import {
  canonicalJson,
  createDraftToken,
  verifyDraftToken,
  DraftTokenError,
} from "../lib/draft-token.js";
import { getRepoRoot } from "../lib/git.js";

test("draft-token: stateless sign/verify roundtrip", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-draft-"));
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "foreman", "MANIFEST.json"),
    path.join(dest, ".gitagent", "foreman", "MANIFEST.json"),
  );
  execSync("git init", { cwd: dest, stdio: "pipe" });
  execSync('git config user.email "teacher@example.com"', { cwd: dest, stdio: "pipe" });
  execSync('git config user.name "Fixture"', { cwd: dest, stdio: "pipe" });
  execSync("git add .", { cwd: dest, stdio: "pipe" });
  execSync('git commit -m "init"', { cwd: dest, stdio: "pipe" });

  const prevCwd = process.cwd();
  process.chdir(dest);
  try {
    const created = createDraftToken(dest, {
      title: "Add hover state",
      msn_id: "MSN-0101",
      skill_key: "ui",
      gate_command: "npm test",
    });
    const verified = verifyDraftToken(dest, created.draft_token, { consume: false });
    assert.equal(verified.msn_id, "MSN-0101");
    assert.equal(verified.title, "Add hover state");
  } finally {
    process.chdir(prevCwd);
  }
});

test("draft-token: replay rejected on second consume", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-draft-replay-"));
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "foreman", "MANIFEST.json"),
    path.join(dest, ".gitagent", "foreman", "MANIFEST.json"),
  );
  execSync("git init", { cwd: dest, stdio: "pipe" });
  execSync('git config user.email "teacher@example.com"', { cwd: dest, stdio: "pipe" });
  execSync('git config user.name "Fixture"', { cwd: dest, stdio: "pipe" });
  execSync("git add .", { cwd: dest, stdio: "pipe" });
  execSync('git commit -m "init"', { cwd: dest, stdio: "pipe" });

  const prevCwd = process.cwd();
  process.chdir(dest);
  try {
    const created = createDraftToken(dest, {
      title: "Replay test",
      msn_id: "MSN-0102",
      skill_key: "ui",
      gate_command: "echo OK",
    });
    verifyDraftToken(dest, created.draft_token, { consume: true });
    assert.throws(
      () => verifyDraftToken(dest, created.draft_token, { consume: true }),
      (e: unknown) => e instanceof DraftTokenError && e.code === "TOKEN_REPLAYED",
    );
  } finally {
    process.chdir(prevCwd);
  }
});

test("draft-token: canonicalJson is deterministic", () => {
  const a = canonicalJson({ b: 2, a: 1, nested: { z: 1, y: 2 } });
  const b = canonicalJson({ nested: { y: 2, z: 1 }, a: 1, b: 2 });
  assert.equal(a, b);
});
