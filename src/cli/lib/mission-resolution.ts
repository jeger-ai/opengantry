import fs from "node:fs";
import path from "node:path";
import { DEFAULT_ACTIVE_MISSION } from "./constants.js";
import { formatRepoRelative } from "./cli-io.js";
import { GapmanUserError } from "./user-error.js";
import { resolveMissionFilePath, resolveMissionFromCandidates } from "./mission-path.js";

export type MissionResolutionProfile = "full" | "status" | "upgrade_apply";

export interface MissionResolutionOptions {
  explicit?: string;
  profile?: MissionResolutionProfile;
  env?: NodeJS.ProcessEnv;
}

const ACTIVE_MISSION_YAML = ".gitagent/missions/ACTIVE_MISSION.yaml";

export function readActiveMissionPin(repoRoot: string): string | null {
  const pinPath = path.join(repoRoot, ".gitagent", "missions", ".active-mission");
  if (!fs.existsSync(pinPath)) return null;
  const line = fs.readFileSync(pinPath, "utf8").trim();
  return line.length > 0 ? line : null;
}

export function buildMissionResolutionCandidates(
  _repoRoot: string,
  options: MissionResolutionOptions = {},
): string[] {
  const env = options.env ?? process.env;
  const profile = options.profile ?? "full";
  const out: string[] = [];

  if (options.explicit?.trim()) out.push(options.explicit.trim());

  if (profile === "full") {
    if (env.GAPMAN_MISSION?.trim()) out.push(env.GAPMAN_MISSION.trim());
  }
  if (profile === "full" || profile === "status") {
    if (env.GXT_MISSION_FILE?.trim()) out.push(env.GXT_MISSION_FILE.trim());
  }

  const pin = readActiveMissionPin(_repoRoot);
  if (pin) out.push(pin);

  if (profile === "full") {
    out.push(DEFAULT_ACTIVE_MISSION);
    out.push(ACTIVE_MISSION_YAML);
  }

  return out;
}

export function resolvePinnedMission(
  repoRoot: string,
  options: MissionResolutionOptions = {},
): string | null {
  return resolveMissionFromCandidates(
    repoRoot,
    buildMissionResolutionCandidates(repoRoot, options),
  );
}

export function resolveMissionPathRequired(
  repoRoot: string,
  options: Omit<MissionResolutionOptions, "profile"> & { errorCode?: string } = {},
): string {
  const explicit = options.explicit?.trim();
  if (explicit) {
    const abs = resolveMissionFilePath(repoRoot, explicit);
    if (fs.existsSync(abs)) return abs;
    throw new GapmanUserError(
      options.errorCode ?? "MISSION_NOT_FOUND",
      `gapman: mission not found at ${explicit}`,
    );
  }

  const rel = resolvePinnedMission(repoRoot, { ...options, profile: "upgrade_apply" });
  if (rel) {
    const abs = resolveMissionFilePath(repoRoot, rel);
    if (fs.existsSync(abs)) return abs;
  }

  throw new GapmanUserError(
    "UPGRADE_MISSION_REQUIRED",
    "gapman upgrade --apply: pass --mission <path> to the signed upgrade mission YAML",
    "Example: gapman upgrade --apply --mission .gitagent/missions/MSN-9001.upgrade-v0.8.1.yaml",
  );
}

export function formatResolvedMissionRel(repoRoot: string, absPath: string): string {
  return formatRepoRelative(repoRoot, absPath);
}
