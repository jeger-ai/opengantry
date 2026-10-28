import { z } from "zod";
import { INTERROGATION_FINDING_KINDS } from "#core/interrogation.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { handleCheckSignature } from "./mcp-check-signature.js";
import { handleDraftLegislation } from "./mcp-draft-legislation.js";
import { handleProposeContract } from "./mcp-propose-contract.js";
import { handleInterrogate, type InterrogateMcpInput } from "./mcp-interrogate.js";
import { handleExecuteLegislation } from "./mcp-execute-legislation.js";
import {
  handleLastError,
  handlePinMission,
  handleResolveMission,
  handleRuntimeEnv,
  handleRuntimeExec,
  handleVerify,
} from "./mcp-runtime.js";
import { handleDoctor } from "./mcp-doctor.js";
import { GATE_ADAPTER_IDS, TYPED_GATE_ADAPTER_IDS } from "#core/gate-adapter.js";

const interrogationRowSchema = z.object({
  finding_id: z.string(),
  kind: z.enum(INTERROGATION_FINDING_KINDS),
  question: z.string(),
  hypothesis: z.string(),
  operator_answer: z.string().describe("Quoted verbatim from operator — never fabricated"),
  adr_refs: z.array(z.string()).optional(),
});

const missionContractSchema = z
  .object({
    tmvc_roots: z.array(z.string()).optional(),
    forbidden_zones: z.array(z.string()).optional(),
    allowed_imports: z.array(z.string()).optional(),
    banned_imports: z.array(z.string()).optional(),
    allow_dynamic_specifiers: z.boolean().optional(),
    strict_relative_imports: z.boolean().optional(),
  })
  .optional();

const gateAdapterSchema = z
  .enum(GATE_ADAPTER_IDS)
  .optional()
  .describe(
    "Explicit gate output parser (ADR-0041): generic (default) | eslint (gate must run eslint --format json) | tsc. Run gxt_doctor first for tsc|eslint.",
  );

const typedDoctorAdapterSchema = z
  .enum(TYPED_GATE_ADAPTER_IDS)
  .optional()
  .describe(
    "Force tsc or eslint adapter preflight even when no typed missions are declared (ADR-0041). Never sniffs gate_command.",
  );

function jsonText(payload: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function registerGxtInterrogateTool(server: McpServer): void {
  server.tool(
    "gxt_interrogate",
    "Deterministic gap analysis before legislation. Returns one next_question (halt) or clear with interrogation_sha256. Do not fabricate operator_answer — quote operator chat verbatim.",
    {
      intent: z.string().describe("Planner intent summary"),
      msn_id: z.string().describe("Mission id advisory label, e.g. MSN-0149"),
      skill_key: z.string().optional().describe("Manifest skill key (default gantry)"),
      gate_command: z.string().optional().describe("Proposed gate command"),
      gate_success_substring: z.string().optional().describe("Proposed gate success substring"),
      paths: z.array(z.string()).optional().describe("Declared paths for boundary analysis"),
      interrogation: z.array(interrogationRowSchema).optional().describe("Accumulated operator answers"),
    },
    async (args) => jsonText(handleInterrogate(args as InterrogateMcpInput)),
  );
}

function registerGxtDraftLegislationTool(server: McpServer): void {
  server.tool(
    "gxt_draft_legislation",
    "Preview proposed mission law without writing files. Requires complete interrogation (server recomputes). Returns draft_token for gxt_execute_legislation after human chat approval. Never fabricate operator_answer.",
    {
      title: z.string().describe("Concise summary of the proposed law"),
      msn_id: z.string().describe('Mission id, e.g. "MSN-0010"'),
      skill_key: z.string().describe("Manifest skill key (e.g. gantry, ui, logic)"),
      gate_command: z.string().describe("Deterministic verification command"),
      gate_success_substring: z.string().optional().describe("Optional gate success substring"),
      gate_adapter: gateAdapterSchema,
      paths: z.array(z.string()).optional().describe("Declared paths for gap analysis"),
      interrogation: z.array(interrogationRowSchema).describe("Complete interrogation answers for all findings"),
      contract: missionContractSchema.describe("Optional Planner-sealed mission cage (ADR-0045)"),
    },
    async (args) => jsonText(handleDraftLegislation(args)),
  );
}

function registerGxtProposeContractTool(server: McpServer): void {
  server.tool(
    "gxt_propose_contract",
    "Deterministically propose a mission contract from intent + repo (read-only). No LLM. Present the block to the operator, then pass the (possibly edited) contract to gxt_draft_legislation.",
    {
      intent: z.string().describe("Planner intent / story"),
      skill_key: z.string().describe("Manifest skill key"),
      paths: z.array(z.string()).optional().describe("Declared path hints"),
    },
    async (args) => jsonText(handleProposeContract(args)),
  );
}

function registerGxtExecuteLegislationTool(server: McpServer): void {
  server.tool(
    "gxt_execute_legislation",
    "Execute gantry legislate using a valid draft_token after explicit human chat approval.",
    {
      draft_token: z.string().describe("Token from gxt_draft_legislation"),
    },
    async (args) => jsonText(handleExecuteLegislation(args.draft_token)),
  );
}

function registerGxtCheckSignatureTool(server: McpServer): void {
  server.tool(
    "gxt_check_signature",
    "Check whether Planner git signature exists for a mission file.",
    {
      mission_file_path: z.string().describe("Repo-relative mission YAML path"),
    },
    async (args) => jsonText(handleCheckSignature(args.mission_file_path)),
  );
}

function registerGxtPinMissionTool(server: McpServer): void {
  server.tool(
    "gxt_pin_mission",
    "Pin active mission for runtime env and Cursor sessionStart hooks.",
    {
      mission_file_path: z.string().describe("Repo-relative mission YAML path"),
    },
    async (args) => jsonText(handlePinMission(args.mission_file_path)),
  );
}

function registerGxtRuntimeEnvTool(server: McpServer): void {
  server.tool(
    "gxt_runtime_env",
    "Return GXT runtime env payload for a mission (GXT_* variables).",
    {
      mission_file_path: z.string().describe("Repo-relative mission path"),
    },
    async (args) => jsonText(handleRuntimeEnv(args.mission_file_path)),
  );
}

function registerGxtVerifyTool(server: McpServer): void {
  server.tool(
    "gxt_verify",
    "Run gantry verify phases for a mission and return structured result.",
    {
      mission_file_path: z.string().describe("Repo-relative mission path"),
      pre_push: z.boolean().optional().describe("Use pre-push legislative stub semantics"),
      skip_stale_evidence: z.boolean().optional().describe("Skip TMVC stale-evidence binding"),
      ci: z.boolean().optional().describe("Authoritative CI mode (perimeter and interrogation fail closed)"),
    },
    async (args) =>
      jsonText(
        await handleVerify(
          args.mission_file_path,
          args.pre_push === true,
          args.skip_stale_evidence === true,
          args.ci === true,
        ),
      ),
  );
}

function registerGxtRuntimeExecTool(server: McpServer): void {
  server.tool(
    "gxt_runtime_exec",
    "Run executor command with mission env + forbidden-zone enforcement.",
    {
      mission_file_path: z.string().describe("Repo-relative mission path"),
      command: z.array(z.string()).describe("Executor argv (after --)"),
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
}

function registerGxtResolveMissionTool(server: McpServer): void {
  server.tool(
    "gxt_resolve_mission",
    "Resolve the active mission: an explicit path, GANTRY_MISSION, GANTRY_MISSION_FILE, the gantry mission pin file, then the legacy ACTIVE_MISSION files.",
    {
      mission_file_path: z.string().optional().describe("Optional explicit mission path override"),
    },
    async (args) => jsonText(handleResolveMission(args.mission_file_path)),
  );
}

function registerGxtDoctorTool(server: McpServer): void {
  server.tool(
    "gxt_doctor",
    "Environment readiness for GXT + explicit gate adapters (ADR-0041). Run before legislating/pinning a `gate_adapter: tsc|eslint` mission. Selection uses declared gate_adapter or explicit override; never sniffs gate_command. Read-only.",
    {
      gate_adapter: typedDoctorAdapterSchema,
      adapter_baseline: z
        .boolean()
        .optional()
        .describe("Opt-in: spawn tsc/eslint for pre-existing debt warnings. Default off."),
      policy_path: z.string().optional().describe("Optional expected policy digest JSON path (gantry doctor --policy)."),
    },
    async (args) => jsonText(handleDoctor(args)),
  );
}

function registerGxtLastErrorTool(server: McpServer): void {
  server.tool(
    "gxt_last_error",
    "Read machine-oriented remediation from GANTRY_LAST_ERROR_FILE.",
    {},
    async () => jsonText(handleLastError()),
  );
}

/** Register all OpenGantry GXT MCP tools on the given server instance. */
export function registerGxtMcpTools(server: McpServer): void {
  registerGxtInterrogateTool(server);
  registerGxtProposeContractTool(server);
  registerGxtDraftLegislationTool(server);
  registerGxtExecuteLegislationTool(server);
  registerGxtCheckSignatureTool(server);
  registerGxtPinMissionTool(server);
  registerGxtRuntimeEnvTool(server);
  registerGxtVerifyTool(server);
  registerGxtRuntimeExecTool(server);
  registerGxtResolveMissionTool(server);
  registerGxtDoctorTool(server);
  registerGxtLastErrorTool(server);
}
