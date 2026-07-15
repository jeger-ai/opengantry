import fs from "node:fs";
import {
  mcpError,
  resolveGuardedMissionAbs,
  type McpErrorBody,
  type PinMissionResult,
} from "./mcp-governance-shared.js";
import { pinMissionFile } from "./missions/parser.js";
import { loadWorkspace } from "./workspace.js";

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
