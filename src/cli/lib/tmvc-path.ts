import type { Manifest } from "#core/mission-types.js";
import { resolveManifestSkillKey } from "./skill-key.js";
import { classifyPath, isPathUnderRoot, law, normalizeRepoRelativePath } from "#core/law.js";

/** Governance transport files — never TMVC drift violations during pre-commit scans. */
export const GOVERNANCE_TRANSPORT_PATHS = [
  "EXECUTOR_LOG.md",
  ".gitagent/missions/.active-mission",
] as const;

export type TmvcPathClassification =
  | "governance_transport"
  | "inside_tmvc"
  | "outside_tmvc"
  | "forbidden_zone";

export { normalizeRepoRelativePath, isPathUnderRoot } from "#core/law.js";

export function isGovernanceTransportPath(repoRel: string): boolean {
  const norm = normalizeRepoRelativePath(repoRel);
  return (GOVERNANCE_TRANSPORT_PATHS as readonly string[]).includes(norm);
}

export function tmvcRootsForSkill(manifest: Manifest, skillKey: string | null): string[] {
  if (!skillKey?.trim()) return [];
  const resolved = resolveManifestSkillKey(manifest, skillKey.trim());
  const skill = manifest.skills[resolved];
  return skill ? [...skill.tmvc_roots] : [];
}

export function forbiddenZonesForSkill(manifest: Manifest, skillKey: string | null): string[] {
  if (!skillKey?.trim()) return [];
  const resolved = resolveManifestSkillKey(manifest, skillKey.trim());
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

export function classifyRepoRelativePath(
  repoRel: string,
  tmvcRoots: readonly string[],
  forbiddenZones: readonly string[],
): TmvcPathClassification {
  const cls = classifyPath(
    law({ allowedRoots: [...tmvcRoots], forbiddenZones: [...forbiddenZones], transportPaths: [...GOVERNANCE_TRANSPORT_PATHS] }),
    repoRel,
  );
  switch (cls) {
    case "transport":
      return "governance_transport";
    case "forbidden_zone":
      return "forbidden_zone";
    case "inside_roots":
      return "inside_tmvc";
    case "outside_roots":
      return "outside_tmvc";
  }
}
