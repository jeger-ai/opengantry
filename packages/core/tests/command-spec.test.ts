import test from "node:test";
import assert from "node:assert/strict";
import { COMMAND_SPEC, MCP_TOOL_SPEC, commandPaths, commanderPaths, danglingToolCommands, hiddenCommanderPaths, mcpToolNames } from "../src/command-spec.js";

test("command spec: unique paths, every tool fronts a known command or none", () => {
  const paths = commandPaths();
  assert.equal(new Set(paths).size, paths.length);
  assert.deepEqual(danglingToolCommands(), []);
  assert.ok(mcpToolNames().includes("gxt_verify"));
  assert.deepEqual(hiddenCommanderPaths(), ["cage-guard", "cage-guard pre-push"]);
  assert.ok(commanderPaths().includes("cage-guard") && !commanderPaths().includes("cage check"));
  assert.ok(commandPaths().includes("cage check"));
  assert.ok(COMMAND_SPEC.length > 80 && MCP_TOOL_SPEC.length >= 20);
});
