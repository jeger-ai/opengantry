/**
 * Outer-boundary tests for scripts/gxt-manifest-lib.mjs CLI contract.
 * argv/exit-code patterns mirror validate-gxt.sh and verify-pr-missions.sh.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { getRepoRoot } from "../lib/git.js";

const LIB = "scripts/gxt-manifest-lib.mjs";

function runManifestLib(root: string, args: string[], input?: string) {
  return spawnSync("node", [LIB, ...args], {
    cwd: root,
    encoding: "utf8",
    input,
  });
}

test("manifest-lib boundary: prefixes argv (validate-gxt + verify-pr-missions)", () => {
  const root = getRepoRoot();
  const r = runManifestLib(root, ["prefixes", root]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const lines = r.stdout.trim().split("\n").filter(Boolean);
  assert.ok(lines.length > 0);
  assert.ok(lines.some((p) => p.includes("src/cli")));
  assert.ok(lines.some((p) => p.startsWith(".gitagent")));
});

test("manifest-lib boundary: validate-manifest argv (validate-gxt cmd_manifest fallback)", () => {
  const root = getRepoRoot();
  const r = runManifestLib(root, ["validate-manifest", root]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /MANIFEST OK/);
});

test("manifest-lib boundary: validate-bypass-note stdin (validate-gxt commit_has_gxt_bypass_note)", () => {
  const root = getRepoRoot();
  const good = runManifestLib(
    root,
    ["validate-bypass-note"],
    JSON.stringify({ v: 1, reason: "documented emergency bypass note" }),
  );
  assert.equal(good.status, 0);

  const bad = runManifestLib(root, ["validate-bypass-note"], JSON.stringify({ v: 1, reason: "short" }));
  assert.equal(bad.status, 1);

  const invalid = runManifestLib(root, ["validate-bypass-note"], "not-json");
  assert.equal(invalid.status, 1);
});

test("manifest-lib boundary: match-glob argv", () => {
  const root = getRepoRoot();
  const hit = runManifestLib(root, ["match-glob", root, "**/.gxt-skill.yaml", "pkg/.gxt-skill.yaml"]);
  assert.equal(hit.status, 0);

  const miss = runManifestLib(root, ["match-glob", root, "**/.gxt-skill.yaml", "README.md"]);
  assert.equal(miss.status, 1);

  const usage = runManifestLib(root, ["match-glob", root, "**/only-pattern"]);
  assert.equal(usage.status, 2);
});

test("manifest-lib boundary: eval-commit argv (validate-gxt msn trusted_automation path)", () => {
  const root = getRepoRoot();
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
  const r = runManifestLib(root, ["eval-commit", root, head]);
  assert.ok(r.status === 0 || r.status === 1, `unexpected exit ${r.status}`);
  if (r.status === 0) {
    assert.match(r.stderr, /TRUSTED-AUTOMATION-OK/i);
  } else {
    assert.match(r.stderr, /TRUSTED-AUTOMATION-DENY:/);
  }

  const usage = runManifestLib(root, ["eval-commit", root]);
  assert.equal(usage.status, 2);
});

test("manifest-lib boundary: eval-range argv (verify-pr-missions trusted_automation path)", () => {
  const root = getRepoRoot();
  const base = spawnSync("git", ["rev-parse", "HEAD~1"], { cwd: root, encoding: "utf8" }).stdout.trim();
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
  const r = runManifestLib(root, ["eval-range", root, base, head]);
  assert.ok(r.status === 0 || r.status === 1, `unexpected exit ${r.status}`);
  if (r.status === 0) {
    assert.match(r.stderr, /TRUSTED-AUTOMATION-OK/i);
  } else {
    assert.match(r.stderr, /TRUSTED-AUTOMATION-DENY:/);
  }

  const usage = runManifestLib(root, ["eval-range", root, base]);
  assert.equal(usage.status, 2);
});

test("manifest-lib boundary: unknown command exits 2", () => {
  const root = getRepoRoot();
  const r = runManifestLib(root, ["not-a-command", root]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Usage:/);
});
