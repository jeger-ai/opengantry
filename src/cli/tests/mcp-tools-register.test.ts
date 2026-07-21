/**
 * Smoke test for mcp-tools-register: all GXT tools register with unique
 * names, descriptions, zod schemas, and async handlers.
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getRepoRoot } from "../lib/git.js";
import { registerGxtMcpTools } from "../lib/mcp-tools-register.js";
import { writeMiniGantryRepo, gitInitCommit } from "./test-fixtures.js";
import { PLANNER_EMAIL } from "./test-shared.js";

interface RegisteredTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

function collectRegisteredTools(): RegisteredTool[] {
  const tools: RegisteredTool[] = [];
  const fakeServer = {
    tool: (
      name: string,
      description: string,
      schema: Record<string, unknown>,
      handler: (args: Record<string, unknown>) => Promise<unknown>,
    ) => {
      tools.push({ name, description, schema, handler });
    },
  } as unknown as McpServer;
  registerGxtMcpTools(fakeServer);
  return tools;
}

test("mcp-tools-register: registers the full gxt_* tool surface", () => {
  const tools = collectRegisteredTools();
  const names = tools.map((t) => t.name);
  assert.deepEqual(new Set(names).size, names.length, "tool names must be unique");
  for (const name of names) {
    assert.match(name, /^gxt_/);
  }
  const expected = [
    "gxt_draft_legislation",
    "gxt_execute_legislation",
    "gxt_check_signature",
    "gxt_pin_mission",
    "gxt_runtime_env",
    "gxt_verify",
    "gxt_attest",
    "gxt_scan",
    "gxt_runtime_exec",
    "gxt_resolve_mission",
    "gxt_last_error",
    "gxt_start_orchestration",
    "gxt_upgrade_plan",
    "gxt_upgrade_apply",
  ];
  assert.deepEqual(names.sort(), [...expected].sort());
});

test("mcp-tools-register: every tool has description, schema object, async handler", () => {
  for (const tool of collectRegisteredTools()) {
    assert.ok(tool.description.length > 10, `${tool.name}: description too short`);
    assert.equal(typeof tool.schema, "object");
    assert.equal(typeof tool.handler, "function");
  }
});

test("mcp-tools-register: gxt_draft_legislation handler round-trips through jsonText envelope", async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-mcp-register-"));
  writeMiniGantryRepo(dest, getRepoRoot());
  gitInitCommit(dest, "chore: init", PLANNER_EMAIL);
  const tools = collectRegisteredTools();
  const draft = tools.find((t) => t.name === "gxt_draft_legislation");
  assert.ok(draft, "gxt_draft_legislation must be registered");
  const prevCwd = process.cwd();
  process.chdir(dest);
  try {
    const result = (await draft.handler({
      title: "smoke test mission",
      msn_id: "MSN-0001",
      skill_key: "ui",
      gate_command: "echo OK",
    })) as { content: Array<{ type: string; text: string }> };
    assert.equal(result.content[0]?.type, "text");
    const payload = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.equal(payload.status, "awaiting_human_approval");
    assert.equal(typeof payload.draft_token, "string");
  } finally {
    process.chdir(prevCwd);
  }
});
