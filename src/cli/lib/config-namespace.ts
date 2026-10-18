import { gitRunOk } from "#git/git.js";

/** Canonical env and git config namespaces (user-facing). One prefix each since 4.0 (ADR-0052 A9). */
export const ENV_PREFIX = "GANTRY_" as const;
export const GIT_CONFIG_PREFIX = "gantry." as const;

export const ENV_PLANNER_EMAILS = "GANTRY_PLANNER_EMAILS" as const;
export const ENV_MISSION = "GANTRY_MISSION" as const;
export const ENV_DEBUG = "GANTRY_DEBUG" as const;

export const GIT_CONFIG_PLANNER_EMAILS = "gantry.plannerEmails" as const;

/** Read GANTRY_<suffix>; blank counts as unset. */
export function readGantryEnv(suffix: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[`${ENV_PREFIX}${suffix}`]?.trim();
  return value || undefined;
}

function readGitConfigKey(repoRoot: string, key: string): string | null {
  const local = gitRunOk(repoRoot, ["config", "--local", "--get", key]);
  if (local.ok && local.stdout.trim()) return local.stdout.trim();
  const global = gitRunOk(repoRoot, ["config", "--global", "--get", key]);
  if (global.ok && global.stdout.trim()) return global.stdout.trim();
  return null;
}

/** Read gantry.<suffix> from the local git config, then the global one. */
export function readGantryGitConfig(repoRoot: string, suffix: string): string | null {
  return readGitConfigKey(repoRoot, `${GIT_CONFIG_PREFIX}${suffix}`);
}
