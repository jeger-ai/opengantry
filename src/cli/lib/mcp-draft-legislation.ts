import { MSN_ID_PATTERN } from "./constants.js";
import { createDraftToken } from "./draft-token.js";
import {
  mcpError,
  type DraftLegislationInput,
  type DraftLegislationResult,
  type McpErrorBody,
} from "./mcp-governance-shared.js";
import { manifestHasSkill, resolveManifestSkillKey } from "./skill-key.js";
import { resolveLegislateGateOptions } from "./legislate-gate-options.js";
import { runInterrogate } from "./interrogate/run.js";
import { loadWorkspace } from "./workspace.js";

function buildDraftChatMessage(input: DraftLegislationInput, manifestSkillDesc?: string): string {
  const lines = [
    "## Proposed GXT mission (draft — not yet written)",
    "",
    `_Do not fabricate operator_answer values. Answers must be quoted verbatim from operator chat._`,
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
  if (input.interrogation.length > 0) {
    lines.push("", "## Interrogation record (review before approving)");
    for (const row of input.interrogation) {
      lines.push(
        "",
        `### ${row.finding_id} (${row.kind})`,
        `**Q:** ${row.question}`,
        `**Hypothesis:** ${row.hypothesis}`,
        `**Operator answer:** ${row.operator_answer}`,
      );
      if (row.adr_refs?.length) {
        lines.push(`**ADR refs:** ${row.adr_refs.join(", ")}`);
      }
    }
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
  if (!Array.isArray(input.interrogation)) {
    return { code: "VALIDATION_ERROR", message: "interrogation array is required", retryable: true };
  }
  return null;
}

export function handleDraftLegislation(
  input: DraftLegislationInput,
): DraftLegislationResult | { status: "error"; error: McpErrorBody } {
  const validation = validateDraftInput(input);
  if (validation) return mcpError(validation.code, validation.message, validation.retryable);

  const { root, manifest } = loadWorkspace();
  const skillKey = resolveManifestSkillKey(manifest, input.skill_key.trim());
  if (!manifestHasSkill(manifest, skillKey)) {
    return mcpError(
      "UNKNOWN_SKILL",
      `unknown skill_key "${input.skill_key}" (manifest skills: ${Object.keys(manifest.skills).join(", ")})`,
      true,
    );
  }

  const gateCommand = input.gate_command.trim();
  const { gateSuccessSubstring } = resolveLegislateGateOptions({
    gateCommand,
    gateSuccessSubstring: input.gate_success_substring,
  });

  const interrogate = runInterrogate({
    root,
    manifest,
    intent: input.title,
    skillKey,
    gateCommand,
    gateSuccessSubstring,
    paths: input.paths ?? [],
    interrogation: input.interrogation,
  });

  if (interrogate.status === "halt") {
    return mcpError(
      "INTERROGATION_INCOMPLETE",
      `Interrogation incomplete: ${interrogate.next_question.finding_id}`,
      false,
    );
  }

  const token = createDraftToken(root, {
    title: input.title,
    msn_id: input.msn_id.trim(),
    skill_key: skillKey,
    gate_command: gateCommand,
    gate_success_substring: gateSuccessSubstring ?? undefined,
    interrogation: interrogate.interrogation,
    interrogation_sha256: interrogate.interrogation_sha256,
    declared_paths: interrogate.declared_paths,
  });

  const draftInput: DraftLegislationInput = {
    ...input,
    skill_key: skillKey,
    interrogation: interrogate.interrogation,
    interrogation_sha256: interrogate.interrogation_sha256,
    declared_paths: interrogate.declared_paths,
  };

  return {
    status: "awaiting_human_approval",
    draft_token: token.draft_token,
    chat_message_to_user: buildDraftChatMessage(
      draftInput,
      manifest.skills[skillKey]?.desc,
    ),
    expires_at: token.expires_at,
    requires_planner_commit: true,
  };
}
