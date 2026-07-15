import { formatRepoRelative } from "./cli-io.js";
import { DraftTokenError, verifyDraftToken } from "./draft-token.js";
import { runLegislate, type LegislateOptions } from "./legislate.js";
import {
  mcpError,
  mcpWriteDenied,
  type ExecuteLegislationResult,
  type McpErrorBody,
} from "./mcp-governance-shared.js";
import { assertMcpMissionWritePath, McpWriteDeniedError } from "./mcp-write-guard.js";
import { loadWorkspace } from "./workspace.js";

export function handleExecuteLegislation(
  draftToken: string,
): ExecuteLegislationResult | { status: "error"; error: McpErrorBody } {
  const { root } = loadWorkspace();

  let payload;
  try {
    payload = verifyDraftToken(root, draftToken, { consume: true });
  } catch (err) {
    if (err instanceof DraftTokenError) {
      return mcpError(err.code, err.message, err.retryable);
    }
    throw err;
  }

  const legislateOpts: LegislateOptions = {
    intent: payload.title,
    msn: payload.msn_id,
    skillKey: payload.skill_key,
    gateCommand: payload.gate_command,
    gateSuccessSubstring: payload.gate_success_substring,
  };

  const result = runLegislate(legislateOpts);
  if (!result.ok) {
    return mcpError("LEGISLATE_FAILED", "gantry legislate failed; check skill_key, msn, or output path", true);
  }

  const missionRel = formatRepoRelative(root, result.missionAbs);
  try {
    assertMcpMissionWritePath(missionRel);
  } catch (err) {
    if (err instanceof McpWriteDeniedError) return mcpWriteDenied(err);
    throw err;
  }
  const escapedTitle = payload.title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const commitMessage = `[${payload.msn_id}] Legislate ${escapedTitle}`;
  const suggestedHumanAction = `git add ${missionRel} && git commit -m "${commitMessage}"`;

  return {
    status: "pending_signature",
    msn_id: payload.msn_id,
    mission_file_path: missionRel,
    suggested_human_action: suggestedHumanAction,
    commit_message: commitMessage,
    commit_target: missionRel,
    requires_planner_commit: true,
    next_tool: "gxt_check_signature",
  };
}
