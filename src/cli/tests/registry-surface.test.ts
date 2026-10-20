/**
 * The public surface is the registries under .gitagent/registry (ADR-0052 B3): the Commander tree, the MCP tool
 * registration and the subcommand each tool fronts are held to commands.yaml and mcp-tools.yaml.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { Command } from "commander";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getRepoRoot } from "#git/git.js";
import { buildProgram } from "../program.js";
import { registerGxtMcpTools } from "../lib/mcp/mcp-tools-register.js";

interface CommandEntry {
  name: string;
  hidden?: boolean;
  /** Parsed inside this command (gantry cage <verb>), not a Commander subcommand. */
  dispatch?: string;
}

interface ToolEntry {
  name: string;
  command: string | null;
}

function registry<T>(file: string): T[] {
  return (YAML.parse(fs.readFileSync(path.join(getRepoRoot(), ".gitagent", "registry", file), "utf8")) as { entries: T[] }).entries;
}

/** Every Commander path with its hidden flag; a subcommand of a hidden group is hidden too. */
function walk(cmd: Command, prefix: string[] = [], parentHidden = false): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const sub of cmd.commands) {
    const p = [...prefix, sub.name()];
    const hidden = parentHidden || (sub as unknown as { _hidden?: boolean })._hidden === true;
    out.set(p.join(" "), hidden);
    for (const [k, v] of walk(sub, p, hidden)) out.set(k, v);
  }
  return out;
}

/** The Commander paths the registry implies: every registered subcommand and its groups; a group is hidden when all its leaves are. */
function expectedTree(entries: CommandEntry[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const e of entries.filter((x) => x.dispatch === undefined)) {
    const parts = e.name.split(" ");
    for (let i = 1; i <= parts.length; i += 1) {
      const p = parts.slice(0, i).join(" ");
      out.set(p, (out.get(p) ?? true) && e.hidden === true);
    }
  }
  return out;
}

const sorted = (m: Map<string, boolean>): [string, boolean][] => [...m.entries()].sort(([a], [b]) => a.localeCompare(b));

test("the Commander tree is exactly the commands registry, hidden flags included", () => {
  const entries = registry<CommandEntry>("commands.yaml");
  const names = entries.map((e) => e.name);
  assert.equal(new Set(names).size, names.length, "duplicate registry entries");
  assert.deepEqual(sorted(walk(buildProgram())), sorted(expectedTree(entries)));
  for (const e of entries.filter((x) => x.dispatch !== undefined)) {
    assert.ok(names.includes(e.dispatch as string), `${e.name} is dispatched by unregistered ${e.dispatch}`);
  }
});

test("the MCP registration is exactly the tools registry, and every fronted subcommand is registered", () => {
  const registered: string[] = [];
  registerGxtMcpTools({ tool: (name: string) => void registered.push(name) } as unknown as McpServer);
  const tools = registry<ToolEntry>("mcp-tools.yaml");
  assert.deepEqual(registered.sort(), tools.map((t) => t.name).sort());
  const commands = new Set(registry<CommandEntry>("commands.yaml").map((e) => e.name));
  for (const t of tools) {
    assert.ok(t.command === null || commands.has(t.command), `${t.name} fronts unregistered ${t.command}`);
  }
});
