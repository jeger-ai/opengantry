import fs from "node:fs";
import path from "node:path";
import type { AgentErrorPayload } from "./errors.js";
import { formatRepoRelative } from "./cli-io.js";
import { MSN_ID_PATTERN } from "./constants.js";
import { createDraftToken, DraftTokenError, verifyDraftToken } from "./draft-token.js";
import { assertPlannerMissionProof } from "./git-proof.js";
import { runLegislate, type LegislateOptions } from "./legislate.js";
import { handleRuntimeEnv, type RuntimeEnvMcpResult } from "./mcp-runtime.js";
import { pinMissionFile, resolveMissionFilePath } from "./missions/parser.js";
import { resolvePinnedMission } from "./missions/parser.js";
import { runStartOrchestration } from "./start-orchestration.js";
import type { TriageResult } from "./types.js";
import { GantryUserError } from "./errors.js";
import { GXT_ERROR } from "./gxt-error-codes.js";
import { manifestHasSkill, resolveManifestSkillKey } from "./skill-key.js";
import { loadWorkspace } from "./workspace.js";
import { assertMcpMissionWritePath, McpWriteDeniedError } from "./mcp-write-guard.js";

export type McpToolStatus =
  | "awaiting_human_approval"
  | "pending_signature"
  | "signature_valid"
  | "signature_missing"
  | "error";

export interface McpErrorBody {
  code: string;
  message: string;
  retryable: boolean;
}

export interface DraftLegislationInput {
  title: string;
  msn_id: string;
  skill_key: string;
  gate_command: string;
  gate_success_substring?: string;
}

export interface DraftLegislationResult {
  status: "awaiting_human_approval";
  draft_token: string;
  chat_message_to_user: string;
  expires_at: string;
  requires_planner_commit: true;
}

export interface ExecuteLegislationResult {
  status: "pending_signature";
  msn_id: string;
  mission_file_path: string;
  suggested_human_action: string;
  commit_message: string;
  commit_target: string;
  requires_planner_commit: true;
  next_tool: "gxt_check_signature";
}

export interface CheckSignatureResult {
  status: "signature_valid" | "signature_missing";
  msn_id: string;
  mission_file_path: string;
  message: string;
  next_tools?: string[];
}

export type PinMissionResult =
  | { status: "pinned"; mission_file_path: string; message: string }
  | { status: "error"; error: McpErrorBody };

export type ResolveMissionResult =
  | { status: "resolved"; mission_file_path: string }
  | {
      status: "unpinned";
      mission_file_path: null;
      message: string;
    };

export type LastErrorResult =
  | { status: "empty"; message: string }
  | { status: "found"; payload: AgentErrorPayload }
  | { status: "error"; message: string };

export type StartOrchestrationMcpResult =
  | {
      status: "ok";
      triage: TriageResult;
      triage_action: string;
      msn_id: string | null;
      mission_file_path: string | null;
      skill_key: string;
      next_actions: string[];
      exit_code: number;
      pinned_mission?: string;
      runtime_env?: RuntimeEnvMcpResult;
      resolve: ResolveMissionResult;
    }
  | {
      status: "failed";
      triage: TriageResult;
      triage_action: string;
      skill_key: string;
      msn_id: string | null;
      mission_file_path: string | null;
      next_actions: string[];
      exit_code: number;
    };

export interface StartOrchestrationInput {
  intent: string;
  msn_id?: string;
  skill_key?: string;
  gate_command?: string;
  gate_success_substring?: string;
  pin_if_needed?: boolean;
  emit_runtime_env?: boolean;
  write_mission?: boolean;
}

export function mcpError(code: string, message: string, retryable: boolean): { status: "error"; error: McpErrorBody } {
  return { status: "error", error: { code, message, retryable } };
}

function mcpWriteDenied(err: McpWriteDeniedError): { status: "error"; error: McpErrorBody } {
  return mcpError(GXT_ERROR.MCP_WRITE_DENIED, err.message, false);
}

type GuardedMissionResolution =
  | { kind: "resolved"; missionAbs: string }
  | { kind: "denied"; error: { status: "error"; error: McpErrorBody } };

function resolveGuardedMissionAbs(root: string, missionFilePath: string): GuardedMissionResolution {
  try {
    assertMcpMissionWritePath(missionFilePath);
  } catch (err) {
    if (err instanceof McpWriteDeniedError) return { kind: "denied", error: mcpWriteDenied(err) };
    throw err;
  }
  return { kind: "resolved", missionAbs: resolveMissionFilePath(root, missionFilePath) };
}

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

export function handleCheckSignature(
  missionFilePath: string,
): CheckSignatureResult | { status: "error"; error: McpErrorBody } {
  const { root } = loadWorkspace();
  const resolution = resolveGuardedMissionAbs(root, missionFilePath);
  if (resolution.kind === "denied") return resolution.error;
  const missionAbs = resolution.missionAbs;

  if (!fs.existsSync(missionAbs)) {
    return mcpError("MISSION_NOT_FOUND", `mission file not found: ${missionFilePath}`, true);
  }

  try {
    const msnId = assertPlannerMissionProof(root, missionAbs);
    const rel = formatRepoRelative(root, missionAbs);
    return {
      status: "signature_valid",
      msn_id: msnId,
      mission_file_path: rel,
      message: `Planner signature valid for ${msnId}. You may pin the mission and begin executor execution.`,
      next_tools: ["gxt_pin_mission", "gxt_runtime_env"],
    };
  } catch (err) {
    if (err instanceof GantryUserError) {
      return {
        status: "signature_missing",
        msn_id: "unknown",
        mission_file_path: formatRepoRelative(root, missionAbs),
        message: err.message,
        next_tools: [],
      };
    }
    throw err;
  }
}

export function handlePinMission(missionFilePath: string): PinMissionResult | { status: "error"; error: McpErrorBody } {
  const { root } = loadWorkspace();
  const resolution = resolveGuardedMissionAbs(root, missionFilePath);
  if (resolution.kind === "denied") return resolution.error;
  const missionAbs = resolution.missionAbs;

  if (!fs.existsSync(missionAbs)) {
    return mcpError("MISSION_NOT_FOUND", `mission file not found: ${missionFilePath}`, true);
  }

  const rel = pinMissionFile(root, missionAbs);
  return {
    status: "pinned",
    mission_file_path: rel,
    message: `Pinned active mission: ${rel}`,
  };
}

export function handleResolveMission(explicit?: string): ResolveMissionResult {
  const { root } = loadWorkspace();
  const resolved = resolvePinnedMission(root, {
    explicit,
    profile: "full",
  });

  if (resolved) {
    return { status: "resolved", mission_file_path: resolved };
  }

  return {
    status: "unpinned",
    mission_file_path: null,
    message: "No active mission pinned. Run Mission Architect / gxt_draft_legislation first.",
  };
}

export function handleLastError(): LastErrorResult {
  const { root } = loadWorkspace();
  const errPath = path.join(root, ".gitagent", "history", ".ignored-last-error.json");
  if (!fs.existsSync(errPath)) {
    return { status: "empty", message: "No last error recorded." };
  }
  try {
    const payload = JSON.parse(fs.readFileSync(errPath, "utf8")) as AgentErrorPayload;
    return { status: "found", payload };
  } catch {
    return { status: "error", message: "Failed to parse last error file." };
  }
}

export function handleStartOrchestration(input: StartOrchestrationInput): StartOrchestrationMcpResult {
  const result = runStartOrchestration({
    intent: input.intent,
    msn: input.msn_id,
    skillKey: input.skill_key,
    gateCommand: input.gate_command,
    gateSuccessSubstring: input.gate_success_substring,
    writeMission: input.write_mission !== false,
    silent: true,
  });

  if (!result.ok) {
    return {
      status: "failed",
      triage: result.triage,
      triage_action: result.triage_action,
      skill_key: result.skill_key,
      msn_id: result.msn_id,
      mission_file_path: result.mission_file_path,
      next_actions: result.next_steps,
      exit_code: result.exit_code,
    };
  }

  const payload: StartOrchestrationMcpResult = {
    status: "ok",
    triage: result.triage,
    triage_action: result.triage_action,
    msn_id: result.msn_id,
    mission_file_path: result.mission_file_path,
    skill_key: result.skill_key,
    next_actions: result.next_steps,
    exit_code: result.exit_code,
    resolve: handleResolveMission(result.mission_file_path ?? undefined),
  };

  if (input.pin_if_needed === true && result.mission_file_path) {
    const { root } = loadWorkspace();
    const resolution = resolveGuardedMissionAbs(root, result.mission_file_path);
    if (resolution.kind === "resolved" && fs.existsSync(resolution.missionAbs)) {
      payload.pinned_mission = pinMissionFile(root, resolution.missionAbs);
    }
  }

  if (input.emit_runtime_env === true && result.mission_file_path) {
    payload.runtime_env = handleRuntimeEnv(result.mission_file_path);
  }

  return payload;
}
