// MSN-0343: the slim package serves the agent read guard (ADR-0056) as `gantry-cage read-guard`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pkgDir } from "./helpers.mjs";

const BIN = path.join(pkgDir, "dist", "cli", "index.js");

test("gantry-cage read-guard denies a Claude Code Read of ~/.ssh and allows a Cursor read of an ordinary file", () => {
  const ssh = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: path.join(os.homedir(), ".ssh", "config") } });
  const denied = spawnSync(process.execPath, [BIN, "read-guard"], { input: ssh, encoding: "utf8" });
  assert.equal(denied.status, 0, denied.stderr);
  assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, "deny");

  const ok = JSON.stringify({ hook_event_name: "beforeReadFile", file_path: path.join(pkgDir, "README.md"), content: "x" });
  const allowed = spawnSync(process.execPath, [BIN, "read-guard"], { input: ok, encoding: "utf8" });
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.deepEqual(JSON.parse(allowed.stdout), { permission: "allow" });
});
