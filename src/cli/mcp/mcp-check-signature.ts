import { logWarn } from "../output/cli-io.js";
import fs from "node:fs";
import { formatRepoRelative } from "#core/posix-path.js";
import { GantryUserError } from "#core/user-error.js";
import { assertPlannerMissionProof } from "#missions/git/git-proof.js";
import {
  mcpError,
  resolveGuardedMissionAbs,
  type CheckSignatureResult,
  type McpErrorBody,
} from "./mcp-governance-shared.js";
import { loadWorkspace } from "#missions/workspace.js";

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
    const msnId = assertPlannerMissionProof(root, missionAbs, { warn: logWarn });
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
