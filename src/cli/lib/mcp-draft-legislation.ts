import { MSN_ID_PATTERN } from "./constants.js";
import { createDraftToken } from "./draft-token.js";
import {
  mcpError,
  type DraftLegislationInput,
  type DraftLegislationResult,
  type McpErrorBody,
} from "./mcp-governance-shared.js";
import { manifestHasSkill, resolveManifestSkillKey } from "./skill-key.js";
import { loadWorkspace } from "./workspace.js";

function buildDraftChatMessage(input: DraftLegislationInput, manifestSkillDesc?: string): string {
  const lines = [
    "## Proposed GXT mission (draft — not yet written)",
    "",
    `- **Title:** ${input.title}`,
    `- **MSN:** ${input.msn_id}`,
    `- **Skill:** ${input.skill_key}`,
    `- **Gate:** \`${input.gate_command}\``,
  ];
  if (input.gate_success_substring?.trim()) {
    lines.push(`- **Gate success substring:** \`${input.gate_success_substring.trim()}\``);
  }
  if (manifestSkillDesc) {
    lines.push(`- **Skill scope:** ${manifestSkillDesc}`);
  }
  lines.push(
    "",
    "Reply with clear approval (e.g. **yes**, **approve**, **looks good**) to execute legislation, or **deny** / **no** to cancel.",
    "",
    "_No mission file will be written until you approve._",
  );
  return lines.join("\n");
}

function validateDraftInput(input: DraftLegislationInput): McpErrorBody | null {
  if (!input.title?.trim()) {
    return { code: "VALIDATION_ERROR", message: "title is required", retryable: true };
  }
  if (!MSN_ID_PATTERN.test(input.msn_id?.trim() ?? "")) {
    return { code: "VALIDATION_ERROR", message: 'msn_id must match "MSN-0007"', retryable: true };
  }
  if (!input.skill_key?.trim()) {
    return { code: "VALIDATION_ERROR", message: "skill_key is required", retryable: true };
  }
  if (!input.gate_command?.trim()) {
    return { code: "VALIDATION_ERROR", message: "gate_command is required", retryable: true };
  }
  return null;
}

export function handleDraftLegislation(
  input: DraftLegislationInput,
): DraftLegislationResult | { status: "error"; error: McpErrorBody } {
  const validation = validateDraftInput(input);
  if (validation) return mcpError(validation.code, validation.message, validation.retryable);

  const { root, manifest } = loadWorkspace();
  const skillKey = input.skill_key.trim();
  if (!manifestHasSkill(manifest, skillKey)) {
    return mcpError(
      "UNKNOWN_SKILL",
      `unknown skill_key "${skillKey}" (manifest skills: ${Object.keys(manifest.skills).join(", ")})`,
      true,
    );
  }

  const token = createDraftToken(root, {
    title: input.title,
    msn_id: input.msn_id.trim(),
    skill_key: skillKey,
    gate_command: input.gate_command,
    gate_success_substring: input.gate_success_substring,
  });

  return {
    status: "awaiting_human_approval",
    draft_token: token.draft_token,
    chat_message_to_user: buildDraftChatMessage(
      input,
      manifest.skills[resolveManifestSkillKey(manifest, skillKey)]?.desc,
    ),
    expires_at: token.expires_at,
    requires_planner_commit: true,
  };
}
