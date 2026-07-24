import fs from "node:fs";

import { formatRepoRelative, logInfo } from "./cli-io.js";
import { GantryUserError } from "./errors.js";
import {
  resolveMissionFilePath,
  resolvePinnedMission,
} from "./missions/parser.js";

export type MissionSource = "flag" | "pin";

export interface ResolvedMissionArg {
  /** Repo-relative POSIX-ish mission path for display and parseMissionFile. */
  missionRel: string;
  missionAbs: string;
  source: MissionSource;
}

const MISSION_REQUIRED_HINT =
  "gantry pin .gitagent/missions/<file>.yaml  # then re-run without --mission";

/**
 * Resolve mission for verify/scan/attest/runtime env.
 * Order: explicit `--mission` flag, then pin/env/legacy active-mission paths.
 * No positional args (verify/scan keep flag→pin only).
 */
export function resolveMissionArg(repoRoot: string, explicit?: string): ResolvedMissionArg {
  const trimmed = explicit?.trim();
  if (trimmed) {
    const abs = resolveMissionFilePath(repoRoot, trimmed);
    if (!fs.existsSync(abs)) {
      throw new GantryUserError(
        "MISSION_NOT_FOUND",
        `gantry: mission not found at ${trimmed}`,
        MISSION_REQUIRED_HINT,
        2,
      );
    }
    return {
      missionRel: formatRepoRelative(repoRoot, abs),
      missionAbs: abs,
      source: "flag",
    };
  }

  const pinRel = resolvePinnedMission(repoRoot, { profile: "full" });
  if (pinRel) {
    const abs = resolveMissionFilePath(repoRoot, pinRel);
    if (fs.existsSync(abs)) {
      return {
        missionRel: formatRepoRelative(repoRoot, abs),
        missionAbs: abs,
        source: "pin",
      };
    }
  }

  throw new GantryUserError(
    "MISSION_REQUIRED",
    "gantry: --mission is required (or pin a mission first)",
    MISSION_REQUIRED_HINT,
    2,
  );
}

/** Human banner when mission came from pin (skipped in JSON / explicit --mission). */
export function emitPinnedMissionBanner(
  resolved: ResolvedMissionArg,
  opts?: { json?: boolean },
): void {
  if (opts?.json) return;
  if (resolved.source !== "pin") return;
  logInfo(`[gantry] Using pinned mission: ${resolved.missionRel}`);
}
