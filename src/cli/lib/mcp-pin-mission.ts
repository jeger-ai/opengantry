import {
  mcpError,
  resolveGuardedMissionAbs,
  type McpErrorBody,
  type PinMissionResult,
} from "./mcp-governance-shared.js";
import { pinActiveMission } from "./missions/parser.js";
import { loadWorkspace } from "./workspace.js";

export function handlePinMission(missionFilePath: string): PinMissionResult | { status: "error"; error: McpErrorBody } {
  const { root } = loadWorkspace();
  const resolution = resolveGuardedMissionAbs(root, missionFilePath);
  if (resolution.kind === "denied") return resolution.error;

  try {
    const rel = pinActiveMission(root, resolution.missionAbs);
    return {
      status: "pinned",
      mission_file_path: rel,
      message: `Pinned active mission: ${rel}`,
    };
  } catch (e) {
    return mcpError("MISSION_NOT_FOUND", `mission file not found: ${missionFilePath}`, true);
  }
}
