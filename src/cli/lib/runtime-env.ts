import fs from "node:fs";
import path from "node:path";
import { toPosixRel } from "./cli-io.js";
import { agentErrorAbsolutePath } from "./errors.js";
import { parseMissionFile } from "./missions/parser.js";
import type { Workspace } from "./workspace.js";
import { defaultWorkerLogPath } from "./trace.js";

export interface ResolvedRuntimeEnv {
  /** Absolute Git repo root */
  repo_root: string;
  /** Repo-relative mission path using forward slashes */
  mission_file: string;
  /** Absolute normalized path to mission file */
  mission_file_absolute: string;
  /** MSN id or empty string when not extracted */
  msn_id: string;
  skill_key: string;
  /** Absolute TMVC roots, newline-delimited string for shells */
  tmvc_roots_joined: string;
  forbidden_zones_joined: string;
  /** Absolute WORKER_LOG path */
  worker_log: string;
}

function toRepoRelativePosix(repoRoot: string, absolutePath: string): string {
  const rel = toPosixRel(repoRoot, path.resolve(absolutePath));
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`gapman runtime: mission path outside repository`);
  }
  return rel;
}

function resolvePaths(repoRoot: string, rootsOrZones: readonly string[]): string[] {
  return rootsOrZones.map((r) =>
    path.resolve(repoRoot, r.replace(/\\/g, path.sep)),
  );
}

/**
 * Resolve worker runtime variables for a mission (manifest-aligned TMVC/forbidden zones).
 */
export function resolveRuntimeEnv(workspace: Workspace, missionRepoOrAbsPath: string): ResolvedRuntimeEnv {
  const { root, manifest } = workspace;
  const missionArg = missionRepoOrAbsPath;
  const mission = parseMissionFile(root, missionArg);
  const skillKey = mission.skillKey?.trim();

  if (!skillKey?.length) {
    throw new Error(`gapman runtime: mission missing skill_key / Skill key (${mission.rawPath})`);
  }

  const skill = manifest.skills[skillKey];
  if (!skill) {
    throw new Error(
      `gapman runtime: manifest has no skill "${skillKey}". Rule 4.4: sync manifest with skills.`,
    );
  }

  const missionAbs = path.resolve(mission.rawPath);
  const missionRel = toRepoRelativePosix(root, missionAbs);
  const msnRaw = mission.msnId ?? "";
  const msn_id = /^MSN-\d{4}$/.test(msnRaw) ? msnRaw : "";

  const tmvcAbs = resolvePaths(root, skill.tmvc_roots);
  const fzAbs = resolvePaths(root, skill.forbidden_zones);

  return {
    repo_root: path.resolve(root),
    mission_file: missionRel,
    mission_file_absolute: missionAbs,
    msn_id,
    skill_key: skillKey,
    tmvc_roots_joined: tmvcAbs.join("\n"),
    forbidden_zones_joined: fzAbs.join("\n"),
    worker_log: defaultWorkerLogPath(root),
  };
}

function lastErrorFileForRepo(repoRoot: string): string {
  const abs = agentErrorAbsolutePath(repoRoot);
  return fs.existsSync(abs) ? abs : "";
}

export function resolvedRuntimeEnvToJsonPayload(r: ResolvedRuntimeEnv): Record<string, string> {
  return {
    GXT_REPO_ROOT: r.repo_root,
    GXT_MISSION_FILE: r.mission_file,
    GXT_MSN_ID: r.msn_id,
    GXT_SKILL_KEY: r.skill_key,
    GXT_TMVC_ROOTS: r.tmvc_roots_joined,
    GXT_FORBIDDEN_ZONES: r.forbidden_zones_joined,
    GXT_WORKER_LOG: r.worker_log,
    GXT_LAST_ERROR_FILE: lastErrorFileForRepo(r.repo_root),
  };
}
