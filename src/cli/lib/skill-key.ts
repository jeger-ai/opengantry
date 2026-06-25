import type { Manifest } from "./types.js";

/** Canonical manifest skill key for CLI delivery work (init / specimen). */
export const CANONICAL_CLI_SKILL_KEY = "gantry" as const;
/** Legacy manifest skill key accepted for backward compatibility. */
export const LEGACY_CLI_SKILL_KEY = "gapman" as const;

const CLI_SKILL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  [CANONICAL_CLI_SKILL_KEY]: [LEGACY_CLI_SKILL_KEY],
  [LEGACY_CLI_SKILL_KEY]: [CANONICAL_CLI_SKILL_KEY],
};

/**
 * Resolve a mission skill_key to a manifest.skills entry when legacy aliases apply.
 * Returns the original key when no manifest match or alias mapping exists.
 */
export function resolveManifestSkillKey(manifest: Manifest, skillKey: string): string {
  if (skillKey in manifest.skills) return skillKey;
  const aliases = CLI_SKILL_ALIASES[skillKey];
  if (!aliases) return skillKey;
  for (const alias of aliases) {
    if (alias in manifest.skills) return alias;
  }
  return skillKey;
}

export function manifestHasSkill(manifest: Manifest, skillKey: string): boolean {
  return resolveManifestSkillKey(manifest, skillKey) in manifest.skills;
}
