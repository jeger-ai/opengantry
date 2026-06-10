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
  requires_teacher_commit: true;
}

export interface ExecuteLegislationResult {
  status: "pending_signature";
  msn_id: string;
  mission_file_path: string;
  suggested_human_action: string;
  commit_message: string;
  commit_target: string;
  requires_teacher_commit: true;
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
  | { status: "found"; payload: Record<string, unknown> }
  | { status: "error"; message: string };

export function mcpError(code: string, message: string, retryable: boolean): { status: "error"; error: McpErrorBody } {
  return { status: "error", error: { code, message, retryable } };
}
