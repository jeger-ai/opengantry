import { loadWorkspace } from "./workspace.js";
import { mcpError, type McpErrorBody } from "./mcp-governance-shared.js";
import type { InterrogationRow } from "./interrogate/findings.js";
import { runInterrogate, type InterrogateResult } from "./interrogate/run.js";
import { resolveLegislateGateOptions } from "./legislate-gate-options.js";
import { resolveManifestSkillKey } from "./skill-key.js";

export interface InterrogateMcpInput {
  intent: string;
  msn_id: string;
  skill_key?: string;
  gate_command?: string;
  gate_success_substring?: string;
  paths?: string[];
  interrogation?: InterrogationRow[];
}

export type InterrogateMcpResult = InterrogateResult | { status: "error"; error: McpErrorBody };

export function handleInterrogate(input: InterrogateMcpInput): InterrogateMcpResult {
  const intent = input.intent?.trim();
  if (!intent) {
    return mcpError("VALIDATION_ERROR", "intent is required", true);
  }
  const { root, manifest } = loadWorkspace();
  const skillKeyRaw = input.skill_key?.trim() || "gantry";
  const skillKey = resolveManifestSkillKey(manifest, skillKeyRaw);
  const { gateCommand, gateSuccessSubstring } = resolveLegislateGateOptions({
    gateCommand: input.gate_command,
    gateSuccessSubstring: input.gate_success_substring,
  });

  return runInterrogate({
    root,
    manifest,
    intent,
    skillKey,
    gateCommand,
    gateSuccessSubstring,
    paths: input.paths ?? [],
    interrogation: input.interrogation,
  });
}
