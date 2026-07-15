import type { AgentErrorPayload } from "./errors.js";
import type { RuntimeEnvMcpResult } from "./mcp-runtime.js";
import type { TriageResult } from "./types.js";
import { GXT_ERROR } from "./gxt-error-codes.js";
import { assertMcpMissionWritePath, McpWriteDeniedError } from "./mcp-write-guard.js";
import { resolveMissionFilePath } from "./missions/parser.js";

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

export function mcpWriteDenied(err: McpWriteDeniedError): { status: "error"; error: McpErrorBody } {
  return mcpError(GXT_ERROR.MCP_WRITE_DENIED, err.message, false);
}

export type GuardedMissionResolution =
  | { kind: "resolved"; missionAbs: string }
  | { kind: "denied"; error: { status: "error"; error: McpErrorBody } };

export function resolveGuardedMissionAbs(root: string, missionFilePath: string): GuardedMissionResolution {
  try {
    assertMcpMissionWritePath(missionFilePath);
  } catch (err) {
    if (err instanceof McpWriteDeniedError) return { kind: "denied", error: mcpWriteDenied(err) };
    throw err;
  }
  return { kind: "resolved", missionAbs: resolveMissionFilePath(root, missionFilePath) };
}
