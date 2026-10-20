import type { Manifest } from "#core/manifest.js";

/** Canonical manifest skill key for CLI delivery work (init / specimen). */
export const CANONICAL_CLI_SKILL_KEY = "gantry" as const;

export function manifestHasSkill(manifest: Manifest, skillKey: string): boolean {
  return skillKey in manifest.skills;
}
