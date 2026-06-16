import fs from "node:fs";
import path from "node:path";
import type { AgentErrorPayload } from "./agent-error.js";
import { formatRepoRelative } from "./cli-io.js";
import { assertTeacherMissionProof } from "./git-proof.js";
import {
  pinMissionFile,
  resolveMissionFilePath,
} from "./mission-path.js";
import { resolvePinnedMission } from "./mission-resolution.js";
import { GapmanUserError } from "./user-error.js";
import {
  type CheckSignatureResult,
  type LastErrorResult,
  type McpErrorBody,
  type PinMissionResult,
  type ResolveMissionResult,
  mcpError,
} from "./mcp-legislation-types.js";
import { loadWorkspace } from "./workspace.js";

export function handleCheckSignature(
  missionFilePath: string,
): CheckSignatureResult | { status: "error"; error: McpErrorBody } {
  const { root } = loadWorkspace();
  const missionAbs = resolveMissionFilePath(root, missionFilePath);

  if (!fs.existsSync(missionAbs)) {
    return mcpError("MISSION_NOT_FOUND", `mission file not found: ${missionFilePath}`, true);
  }

  try {
    const msnId = assertTeacherMissionProof(root, missionAbs);
    const rel = formatRepoRelative(root, missionAbs);
    return {
      status: "signature_valid",
      msn_id: msnId,
      mission_file_path: rel,
      message: `Teacher signature valid for ${msnId}. You may pin the mission and begin worker execution.`,
      next_tools: ["gxt_pin_mission", "gxt_runtime_env"],
    };
  } catch (err) {
    if (err instanceof GapmanUserError) {
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
  const missionAbs = resolveMissionFilePath(root, missionFilePath);

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
