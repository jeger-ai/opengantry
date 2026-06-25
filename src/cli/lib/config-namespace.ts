import { gitRunOk } from "./git.js";

/** Canonical env/config namespaces (user-facing). Legacy GAPMAN/gantry.* read silently when unset. */
export const ENV_PREFIX = "GANTRY_" as const;
export const LEGACY_ENV_PREFIX = "GAPMAN_" as const;
export const GIT_CONFIG_PREFIX = "gantry." as const;
export const LEGACY_GIT_CONFIG_PREFIX = "gapman." as const;

export const ENV_TEACHER_EMAILS = "GANTRY_TEACHER_EMAILS" as const;
export const ENV_MISSION = "GANTRY_MISSION" as const;
export const ENV_DEBUG = "GANTRY_DEBUG" as const;

export const GIT_CONFIG_TEACHER_EMAILS = "gantry.teacherEmails" as const;

/**
 * Read env var preferring GANTRY_<suffix>, then silent GAPMAN_<suffix> fallback.
 */
export function readEnvWithLegacy(suffix: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const canonical = env[`${ENV_PREFIX}${suffix}`]?.trim();
  if (canonical) return canonical;
  const legacy = env[`${LEGACY_ENV_PREFIX}${suffix}`]?.trim();
  return legacy || undefined;
}

function readGitConfigKey(repoRoot: string, key: string): string | null {
  const local = gitRunOk(repoRoot, ["config", "--local", "--get", key]);
  if (local.ok && local.stdout.trim()) return local.stdout.trim();
  const global = gitRunOk(repoRoot, ["config", "--global", "--get", key]);
  if (global.ok && global.stdout.trim()) return global.stdout.trim();
  return null;
}

/**
 * Read git config preferring gantry.<suffix>, then silent gapman.<suffix> fallback.
 */
export function readGitConfigWithLegacy(repoRoot: string, suffix: string): string | null {
  const canonical = readGitConfigKey(repoRoot, `${GIT_CONFIG_PREFIX}${suffix}`);
  if (canonical) return canonical;
  return readGitConfigKey(repoRoot, `${LEGACY_GIT_CONFIG_PREFIX}${suffix}`);
}
