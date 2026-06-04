import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  handleCheckSignature,
  handleDraftLegislation,
  handleExecuteLegislation,
  handleLastError,
  handlePinMission,
  handleResolveMission,
} from "./mcp-legislation.js";
import { handleRuntimeEnv, handleRuntimeExec, handleVerify } from "./mcp-runtime.js";
import { handleStartOrchestration } from "./mcp-orchestration.js";
import { handleUpgradeApply, handleUpgradePlan } from "./mcp-upgrade.js";

function jsonText(payload: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function registerLegislationTools(server: McpServer): void {
  server.tool(
    "gxt_draft_legislation",
    "Preview proposed mission law without writing files. Returns draft_token for gxt_execute_legislation after human chat approval.",
    {
      title: z.string().describe("Concise summary of the proposed law"),
      msn_id: z.string().describe('Mission id, e.g. "MSN-0010"'),
      skill_key: z.string().describe("Manifest skill key (e.g. gapman, ui, logic)"),
      gate_command: z.string().describe("Deterministic verification command"),
      gate_success_substring: z.string().optional().describe("Optional gate success substring"),
    },
    async (args) => jsonText(handleDraftLegislation(args)),
  );

  server.tool(
    "gxt_execute_legislation",
    "Execute gapman legislate using a valid draft_token after explicit human chat approval.",
    {
      draft_token: z.string().describe("Token from gxt_draft_legislation"),
    },
    async (args) => jsonText(handleExecuteLegislation(args.draft_token)),
  );

  server.tool(
    "gxt_check_signature",
    "Check whether Teacher git signature exists for a mission file.",
    {
      mission_file_path: z.string().describe("Repo-relative mission YAML path"),
    },
    async (args) => jsonText(handleCheckSignature(args.mission_file_path)),
  );

  server.tool(
    "gxt_pin_mission",
    "Pin active mission for runtime env and Cursor sessionStart hooks.",
    {
      mission_file_path: z.string().describe("Repo-relative mission YAML path"),
    },
    async (args) => jsonText(handlePinMission(args.mission_file_path)),
  );
}

function registerRuntimeTools(server: McpServer): void {
  server.tool(
    "gxt_runtime_env",
    "Return GXT runtime env payload for a mission (GXT_* variables).",
    {
      mission_file_path: z.string().describe("Repo-relative mission path"),
    },
    async (args) => jsonText(handleRuntimeEnv(args.mission_file_path)),
  );

  server.tool(
    "gxt_verify",
    "Run gapman verify phases for a mission and return structured result.",
    {
      mission_file_path: z.string().describe("Repo-relative mission path"),
      pre_push: z.boolean().optional().describe("Use pre-push legislative stub semantics"),
    },
    async (args) => jsonText(handleVerify(args.mission_file_path, args.pre_push === true)),
  );

  server.tool(
    "gxt_runtime_exec",
    "Run worker command with mission env + forbidden-zone enforcement.",
    {
      mission_file_path: z.string().describe("Repo-relative mission path"),
      command: z.array(z.string()).describe("Worker argv (after --)"),
      cwd: z.string().optional(),
      timeout_ms: z.number().int().positive().optional(),
    },
    async (args) =>
      jsonText(
        await handleRuntimeExec({
          mission: args.mission_file_path,
          command: args.command,
          cwd: args.cwd,
          timeout_ms: args.timeout_ms,
        }),
      ),
  );

  server.tool(
    "gxt_resolve_mission",
    "Resolve active mission using the same order as gxt-resolve-mission.sh.",
    {
      mission_file_path: z.string().optional().describe("Optional explicit mission path override"),
    },
    async (args) => jsonText(handleResolveMission(args.mission_file_path)),
  );

  server.tool(
    "gxt_last_error",
    "Read machine-oriented remediation from GXT_LAST_ERROR_FILE.",
    {},
    async () => jsonText(handleLastError()),
  );

  server.tool(
    "gxt_start_orchestration",
    "Goal-first flow: triage → legislate stub → optional pin/runtime env hints.",
    {
      intent: z.string().describe("What the developer wants to build"),
      msn_id: z.string().optional().describe("Mission id (auto-suggested when omitted)"),
      skill_key: z.string().optional().describe("Override manifest skill_key"),
      gate_command: z.string().optional().describe("Deterministic gate command"),
      gate_success_substring: z.string().optional().describe("Gate success substring"),
      pin_if_needed: z.boolean().optional().describe("Pin mission after scaffold"),
      emit_runtime_env: z.boolean().optional().describe("Include gxt_runtime_env payload"),
      write_mission: z.boolean().optional().describe("Write mission YAML (default true)"),
    },
    async (args) => jsonText(handleStartOrchestration(args)),
  );
}

function registerUpgradeTools(server: McpServer): void {
  server.tool(
    "gxt_upgrade_plan",
    "Plan substrate upgrade: stage managed_strict assets and draft upgrade mission YAML.",
    {
      msn_id: z.string().optional().describe("Optional MSN-NNNN in upgrade band (9000-9099)"),
      dry_run: z.boolean().optional().describe("Preview plan without writing files"),
    },
    async (args) => jsonText(handleUpgradePlan({ msn_id: args.msn_id, dry_run: args.dry_run })),
  );

  server.tool(
    "gxt_upgrade_apply",
    "Apply Teacher-signed substrate upgrade after staged hash verification.",
    {
      mission_file_path: z.string().optional().describe("Signed upgrade mission YAML path"),
    },
    async (args) => jsonText(await handleUpgradeApply(args.mission_file_path)),
  );
}

/** Register all OpenGantry GXT MCP tools on the given server instance. */
export function registerGxtMcpTools(server: McpServer): void {
  registerLegislationTools(server);
  registerRuntimeTools(server);
  registerUpgradeTools(server);
}
