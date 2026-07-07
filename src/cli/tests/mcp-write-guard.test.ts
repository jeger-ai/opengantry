import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import {
  assertMcpMissionWritePath,
  assertMcpSkillWritePath,
  assertMcpSubstrateUpgradeWritePaths,
  McpWriteDeniedError,
} from "../lib/mcp-write-guard.js";
import { GXT_ERROR } from "../lib/gxt-error-codes.js";
import { handlePinMission } from "../lib/mcp-governance.js";
import { getRepoRoot } from "../lib/git.js";
import { loadManifest } from "../lib/manifest.js";

function scaffoldRepo(): string {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-mcp-write-guard-"));
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "foreman", "MANIFEST.json"),
    path.join(dest, ".gitagent", "foreman", "MANIFEST.json"),
  );
  execSync("git init", { cwd: dest, stdio: "pipe" });
  return dest;
}

test("mcp-write-guard: mission path must stay under .gitagent/missions/", () => {
  assert.throws(
    () => assertMcpMissionWritePath("src/cli/evil.ts"),
    (err: unknown) => err instanceof McpWriteDeniedError,
  );
  assert.doesNotThrow(() => assertMcpMissionWritePath(".gitagent/missions/MSN-0001.foo.yaml"));
});

test("mcp-write-guard: rejects path traversal", () => {
  assert.throws(
    () => assertMcpMissionWritePath(".gitagent/missions/../foreman/MANIFEST.json"),
    /traversal/,
  );
});

test("mcp-write-guard: skill write inside TMVC allowed, outside denied", () => {
  const dest = scaffoldRepo();
  const manifest = loadManifest(dest);
  assert.doesNotThrow(() => assertMcpSkillWritePath(manifest, "gantry", "src/cli/lib/foo.ts"));
  assert.throws(
    () => assertMcpSkillWritePath(manifest, "gantry", "README.md"),
    (err: unknown) => err instanceof McpWriteDeniedError,
  );
});

test("mcp-write-guard: skill write forbidden zone denied", () => {
  const dest = scaffoldRepo();
  const manifest = loadManifest(dest);
  assert.throws(
    () => assertMcpSkillWritePath(manifest, "gantry", ".gitagent/foreman/MANIFEST.json"),
    /forbidden zone/,
  );
});

test("mcp-write-guard: substrate upgrade allows forbidden paths listed in planned_writes", () => {
  const dest = scaffoldRepo();
  const manifest = loadManifest(dest);
  assert.doesNotThrow(() =>
    assertMcpSubstrateUpgradeWritePaths(manifest, [".gitagent/planner/RULES.md"]),
  );
});

test("mcp-write-guard: McpWriteDeniedError maps to GXT_MCP_WRITE_DENIED", () => {
  try {
    assertMcpMissionWritePath("outside.yaml");
  } catch (err) {
    assert.ok(err instanceof McpWriteDeniedError);
    assert.equal(err.gxtCode, GXT_ERROR.MCP_WRITE_DENIED);
  }
});

test("mcp governance: pin rejects mission outside missions dir", () => {
  const dest = scaffoldRepo();
  const prevCwd = process.cwd();
  process.chdir(dest);
  try {
    const missionAbs = path.join(dest, "evil-mission.yaml");
    fs.writeFileSync(missionAbs, "msn_id: MSN-0999\nskill_key: gantry\ngate_command: echo OK\n", "utf8");
    const result = handlePinMission("evil-mission.yaml");
    assert.equal(result.status, "error");
    if (result.status === "error") {
      assert.equal(result.error.code, GXT_ERROR.MCP_WRITE_DENIED);
    }
  } finally {
    process.chdir(prevCwd);
  }
});
