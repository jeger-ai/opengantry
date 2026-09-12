import { contractSha256, normalizeContract } from "./contract/contract-hash.js";
import { resolveEffectiveScope } from "./contract/effective-scope.js";
import { formatContractBlock } from "./contract/format.js";
import { proposeContract } from "./contract/propose.js";
import { mcpError, type McpErrorBody } from "./mcp-governance-shared.js";
import { manifestHasSkill, resolveManifestSkillKey } from "./skill-key.js";
import type { MissionContract } from "./types.js";
import { loadWorkspace } from "./workspace.js";

export interface ProposeContractMcpInput {
  intent: string;
  skill_key?: string;
  paths?: string[];
}

export interface ProposeContractMcpResult {
  status: "ok";
  skill_key: string;
  contract: MissionContract;
  contract_sha256: string;
  gate_command: string;
  gate_success_substring: string | null;
  rationale: string[];
  block: string;
}

export function handleProposeContract(
  input: ProposeContractMcpInput,
): ProposeContractMcpResult | { status: "error"; error: McpErrorBody } {
  if (!input.intent?.trim()) {
    return mcpError("VALIDATION_ERROR", "intent is required", true);
  }
  const { root, manifest } = loadWorkspace();
  const skillKey = input.skill_key?.trim()
    ? resolveManifestSkillKey(manifest, input.skill_key.trim())
    : undefined;
  if (skillKey && !manifestHasSkill(manifest, skillKey)) {
    return mcpError(
      "UNKNOWN_SKILL",
      `unknown skill_key "${input.skill_key}" (manifest skills: ${Object.keys(manifest.skills).join(", ")})`,
      true,
    );
  }
  if (!skillKey) {
    return mcpError("VALIDATION_ERROR", "skill_key is required for gxt_propose_contract", true);
  }

  const proposed = proposeContract({
    root,
    manifest,
    intent: input.intent.trim(),
    skillKey,
    paths: input.paths,
  });
  const contract = normalizeContract(proposed.contract);
  try {
    resolveEffectiveScope({ manifest, skillKey, contract });
  } catch (e) {
    return mcpError("CONTRACT_SCOPE_ESCAPE", e instanceof Error ? e.message : String(e), true);
  }
  return {
    status: "ok",
    skill_key: skillKey,
    contract,
    contract_sha256: contractSha256(contract),
    gate_command: proposed.gate.command,
    gate_success_substring: proposed.gate.successSubstring,
    rationale: proposed.rationale,
    block: formatContractBlock(contract, proposed.gate),
  };
}
