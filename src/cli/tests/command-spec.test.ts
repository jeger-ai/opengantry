/**
 * The command specification binds three things that used to drift on their own: the Commander tree, the MCP tool
 * registration and the registries under .gitagent/registry (ADR-0052 step 5d).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { Command } from "commander";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { COMMAND_SPEC, MCP_TOOL_SPEC, commandPaths, commanderPaths, hiddenCommanderPaths, mcpToolNames } from "#core/command-spec.js";
import { getRepoRoot } from "#git/git.js";
import { buildProgram } from "../program.js";
import { registerGxtMcpTools } from "../lib/mcp/mcp-tools-register.js";

interface Walked {
  path: string;
  hidden: boolean;
}

/** The dispatched cage verbs (gantry cage check|watch|suggest) are not Commander subcommands; the cage package parses them. */

function walk(cmd: Command, prefix: string[], parentHidden: boolean, out: Walked[]): void {
  for (const sub of cmd.commands) {
    const p = [...prefix, sub.name()];
    const hidden = parentHidden || (sub as unknown as { _hidden?: boolean })._hidden === true;
    out.push({ path: p.join(" "), hidden });
    walk(sub, p, hidden, out);
  }
}

function registryNames(file: string): string[] {
  const doc = YAML.parse(fs.readFileSync(path.join(getRepoRoot(), ".gitagent", "registry", file), "utf8")) as {
    entries: { name: string; hidden?: boolean }[];
  };
  return doc.entries.map((e) => e.name).sort();
}

test("every Commander subcommand is in the spec and vice versa, hidden flags included", () => {
  const walked: Walked[] = [];
  walk(buildProgram(), [], false, walked);
  assert.deepEqual(walked.map((w) => w.path).sort(), commanderPaths());
  assert.deepEqual(walked.filter((w) => w.hidden).map((w) => w.path).sort(), hiddenCommanderPaths());
});

test("every registered MCP tool is in the spec and vice versa", () => {
  const names: string[] = [];
  const fakeServer = { tool: (name: string) => { names.push(name); } } as unknown as McpServer;
  registerGxtMcpTools(fakeServer);
  assert.deepEqual(names.sort(), mcpToolNames());
});

test("the registries list exactly the spec's commands and tools", () => {
  assert.deepEqual(registryNames("commands.yaml"), commandPaths());
  assert.deepEqual(registryNames("mcp-tools.yaml"), mcpToolNames());
  const spec = new Map(COMMAND_SPEC.map((e) => [e.path, e]));
  for (const t of MCP_TOOL_SPEC) {
    if (t.command !== null) assert.ok(spec.has(t.command), `${t.name} fronts ${t.command}`);
  }
});
