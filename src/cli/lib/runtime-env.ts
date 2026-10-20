import fs from "node:fs";
import path from "node:path";
import { toPosixRel } from "#core/posix-path.js";
import { CLI_NAME } from "#core/constants.js";
import type { EffectiveScope } from "#core/contract-types.js";
import { loadPolicyBundleQuiet, resolveEffectiveScope } from "#missions/contract/effective-scope.js";
import { agentErrorAbsolutePath } from "./errors.js";
import { parseMissionFile } from "./missions/parser.js";
import type { Workspace } from "#missions/workspace.js";
import { defaultExecutorLogPath } from "#missions/trace-quote.js";

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
  /** Absolute EXECUTOR_LOG path */
  executor_log: string;
  /** Effective cage (skill ∪ contract ∪ policy, tighten-only). */
  scope: EffectiveScope;
}

function toRepoRelativePosix(repoRoot: string, absolutePath: string): string {
  const rel = toPosixRel(repoRoot, path.resolve(absolutePath));
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`${CLI_NAME} runtime: mission path outside repository`);
  }
  return rel;
}

function resolvePaths(repoRoot: string, rootsOrZones: readonly string[]): string[] {
  return rootsOrZones.map((r) =>
    path.resolve(repoRoot, r.replace(/\\/g, path.sep)),
  );
}

/**
 * Resolve executor runtime variables for a mission (manifest-aligned TMVC/forbidden zones).
 */
export function resolveRuntimeEnv(workspace: Workspace, missionRepoOrAbsPath: string): ResolvedRuntimeEnv {
  const { root, manifest } = workspace;
  const missionArg = missionRepoOrAbsPath;
  const mission = parseMissionFile(root, missionArg);
  const skillKey = mission.skillKey?.trim();

  if (!skillKey?.length) {
    throw new Error(`${CLI_NAME} runtime: mission missing skill_key / Skill key (${mission.rawPath})`);
  }

  const resolvedKey = skillKey;
  const skill = manifest.skills[resolvedKey];
  if (!skill) {
    throw new Error(
      `${CLI_NAME} runtime: manifest has no skill "${skillKey}". Rule 4.4: sync manifest with skills.`,
    );
  }

  const missionAbs = path.resolve(mission.rawPath);
  const missionRel = toRepoRelativePosix(root, missionAbs);
  const msnRaw = mission.msnId ?? "";
  const msn_id = /^MSN-\d{4}$/.test(msnRaw) ? msnRaw : "";

  const scope = resolveEffectiveScope({
    manifest,
    skillKey: resolvedKey,
    contract: mission.contract,
    policy: loadPolicyBundleQuiet(root),
  });
  const tmvcAbs = resolvePaths(root, scope.tmvcRoots);
  const fzAbs = resolvePaths(root, scope.forbiddenZones);

  return {
    repo_root: path.resolve(root),
    mission_file: missionRel,
    mission_file_absolute: missionAbs,
    msn_id,
    skill_key: skillKey,
    tmvc_roots_joined: tmvcAbs.join("\n"),
    forbidden_zones_joined: fzAbs.join("\n"),
    executor_log: defaultExecutorLogPath(root),
    scope,
  };
}

function lastErrorFileForRepo(repoRoot: string): string {
  const abs = agentErrorAbsolutePath(repoRoot);
  return fs.existsSync(abs) ? abs : "";
}

export function resolvedRuntimeEnvToJsonPayload(r: ResolvedRuntimeEnv): Record<string, string> {
  return {
    GANTRY_REPO_ROOT: r.repo_root,
    GANTRY_MISSION_FILE: r.mission_file,
    GANTRY_MSN_ID: r.msn_id,
    GANTRY_SKILL_KEY: r.skill_key,
    GANTRY_TMVC_ROOTS_ABSOLUTE: r.tmvc_roots_joined,
    GANTRY_TMVC_ROOTS: r.scope.tmvcRoots.map((root) => root.replace(/\\/g, "/")).join(" "),
    GANTRY_FORBIDDEN_ZONES: r.forbidden_zones_joined,
    GANTRY_ALLOWED_IMPORTS: r.scope.allowedImports.join("\n"),
    GANTRY_BANNED_IMPORTS: r.scope.bannedImports.join("\n"),
    GANTRY_EXECUTOR_LOG: r.executor_log,
    GANTRY_LAST_ERROR_FILE: lastErrorFileForRepo(r.repo_root),
  };
}
