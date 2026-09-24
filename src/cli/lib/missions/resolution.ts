import fs from "node:fs";
import path from "node:path";
import { DEFAULT_ACTIVE_MISSION } from "../constants.js";
import { readEnvWithLegacy } from "../config-namespace.js";
import { formatRepoRelative } from "../cli-io.js";
import { GantryUserError } from "../errors.js";

export function resolveMissionFilePath(repoRoot: string, missionFilePath: string): string {
  return path.isAbsolute(missionFilePath)
    ? path.resolve(missionFilePath)
    : path.join(repoRoot, missionFilePath.replace(/\\/g, path.sep));
}

/** Absolute paths of files under `.gitagent/missions/` (non-recursive). */
export function listMissionFiles(root: string): string[] {
  const dir = path.join(root, ".gitagent", "missions");
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    out.push(path.join(dir, ent.name));
  }
  return out;
}

export function pinMissionFile(repoRoot: string, missionAbs: string): string {
  const rel = formatRepoRelative(repoRoot, missionAbs);
  const pinPath = path.join(repoRoot, ".gitagent", "missions", ".active-mission");
  fs.mkdirSync(path.dirname(pinPath), { recursive: true });
  fs.writeFileSync(pinPath, `${rel}\n`, "utf8");
  return rel;
}

/** Resolve mission path, assert it exists, and pin as the active mission. */
export function pinActiveMission(repoRoot: string, missionPathOrAbs: string): string {
  const abs = resolveMissionFilePath(repoRoot, missionPathOrAbs);
  if (!fs.existsSync(abs)) {
    throw new GantryUserError(
      "MISSION_NOT_FOUND",
      `gantry pin: mission file not found: ${missionPathOrAbs}`,
      undefined,
      2,
    );
  }
  return pinMissionFile(repoRoot, abs);
}

/** Clear `.gitagent/missions/.active-mission`. Returns true if a pin was removed. */
export function clearActiveMissionPin(repoRoot: string): boolean {
  const pinPath = path.join(repoRoot, ".gitagent", "missions", ".active-mission");
  if (!fs.existsSync(pinPath)) return false;
  fs.unlinkSync(pinPath);
  return true;
}

export function resolveMissionFromCandidates(repoRoot: string, candidates: string[]): string | null {
  for (const c of candidates) {
    const trimmed = c.trim();
    if (!trimmed) continue;
    const abs = resolveMissionFilePath(repoRoot, trimmed);
    if (fs.existsSync(abs)) {
      return formatRepoRelative(repoRoot, abs);
    }
  }
  return null;
}

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
    const missionEnv = readEnvWithLegacy("MISSION", env);
    if (missionEnv) out.push(missionEnv);
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
    throw new GantryUserError(
      options.errorCode ?? "MISSION_NOT_FOUND",
      `gantry: mission not found at ${explicit}`,
    );
  }

  const rel = resolvePinnedMission(repoRoot, { ...options, profile: "upgrade_apply" });
  if (rel) {
    const abs = resolveMissionFilePath(repoRoot, rel);
    if (fs.existsSync(abs)) return abs;
  }

  throw new GantryUserError(
    "UPGRADE_MISSION_REQUIRED",
    "gantry upgrade --apply: pass --mission <path> to the signed upgrade mission YAML",
    "Example: gantry upgrade --apply --mission .gitagent/missions/MSN-9001.upgrade-v0.8.1.yaml",
  );
}

export function formatResolvedMissionRel(repoRoot: string, absPath: string): string {
  return formatRepoRelative(repoRoot, absPath);
}
