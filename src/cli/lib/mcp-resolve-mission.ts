import { resolvePinnedMission } from "./missions/parser.js";
import { type ResolveMissionResult } from "./mcp-governance-shared.js";
import { loadWorkspace } from "./workspace.js";

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
