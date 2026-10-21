import type { Manifest } from "#core/manifest.js";
import { isPathUnderRoot } from "#core/law.js";
import { normalizeRepoRelativePath } from "#core/posix-path.js";

export function tmvcRootsForSkill(manifest: Manifest, skillKey: string | null): string[] {
  if (!skillKey?.trim()) return [];
  const resolved = skillKey.trim();
  const skill = manifest.skills[resolved];
  return skill ? [...skill.tmvc_roots] : [];
}

export function forbiddenZonesForSkill(manifest: Manifest, skillKey: string | null): string[] {
  if (!skillKey?.trim()) return [];
  const resolved = skillKey.trim();
  const skill = manifest.skills[resolved];
  return skill ? [...skill.forbidden_zones] : [];
}

/** Longest matching manifest.path_risks prefix for a repo-relative path. */
export function pathRiskTier(manifest: Manifest, repoRel: string): string {
  const norm = normalizeRepoRelativePath(repoRel);
  let bestTier = "unlisted";
  let bestLen = 0;
  for (const [prefix, tier] of Object.entries(manifest.path_risks)) {
    const p = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    if (isPathUnderRoot(norm, p)) {
      if (p.length >= bestLen) {
        bestLen = p.length;
        bestTier = tier;
      }
    }
  }
  return bestTier;
}
