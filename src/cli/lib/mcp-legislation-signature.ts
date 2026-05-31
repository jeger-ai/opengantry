import fs from "node:fs";
import path from "node:path";
import { assertTeacherMissionProof } from "./git-proof.js";
import { formatRepoRelative } from "./cli-io.js";
import { mcpError, type McpErrorBody } from "./mcp-error.js";
import {
  pinMissionFile,
  resolveMissionFilePath,
  resolveMissionFromCandidates,
} from "./mission-path.js";
import { GapmanUserError } from "./user-error.js";
import { loadWorkspace } from "./workspace.js";

export interface CheckSignatureResult {
  status: "signature_valid" | "signature_missing";
  msn_id: string;
  mission_file_path: string;
  message: string;
  next_tools?: string[];
}

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

export function handlePinMission(missionFilePath: string): Record<string, unknown> {
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

export function handleResolveMission(explicit?: string): Record<string, unknown> {
  const { root } = loadWorkspace();

  const candidates: string[] = [];
  if (explicit?.trim()) candidates.push(explicit.trim());
  if (process.env.GAPMAN_MISSION?.trim()) candidates.push(process.env.GAPMAN_MISSION.trim());
  if (process.env.GXT_MISSION_FILE?.trim()) candidates.push(process.env.GXT_MISSION_FILE.trim());

  const pinFile = path.join(root, ".gitagent", "missions", ".active-mission");
  if (fs.existsSync(pinFile)) {
    const line = fs.readFileSync(pinFile, "utf8").trim();
    if (line) candidates.push(line);
  }
  candidates.push(".gitagent/missions/ACTIVE_MISSION.md");
  candidates.push(".gitagent/missions/ACTIVE_MISSION.yaml");

  const resolved = resolveMissionFromCandidates(root, candidates);
  if (resolved) {
    return { status: "resolved", mission_file_path: resolved };
  }

  return {
    status: "unpinned",
    mission_file_path: null,
    message: "No active mission pinned. Run Mission Architect / gxt_draft_legislation first.",
  };
}

export function handleLastError(): Record<string, unknown> {
  const { root } = loadWorkspace();
  const errPath = path.join(root, ".gitagent", "history", ".ignored-last-error.json");
  if (!fs.existsSync(errPath)) {
    return { status: "empty", message: "No last error recorded." };
  }
  try {
    const payload = JSON.parse(fs.readFileSync(errPath, "utf8")) as Record<string, unknown>;
    return { status: "found", payload };
  } catch {
    return { status: "error", message: "Failed to parse last error file." };
  }
}
