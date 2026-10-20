import type { Manifest } from "#core/manifest.js";
import { isPathUnderRoot, normalizeRepoRelativePath } from "#core/law.js";
import { judgePath, pathLaw, type PathLaw } from "#core/path-law.js";

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

export function isGovernanceTransportPath(repoRel: string): boolean {
  const norm = normalizeRepoRelativePath(repoRel);
  return (GOVERNANCE_TRANSPORT_PATHS as readonly string[]).includes(norm);
}

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

/**
 * The mission scope as a path law (ADR-0053): the effective roots are the area, the effective forbidden zones are
 * deny rules, governance transport is exempt. Built from the effective lists, which are already composed
 * tighten-only (contract roots inside skill roots, zones unioned with the org floor).
 */
export function scopePathLaw(
  tmvcRoots: readonly string[],
  forbiddenZones: readonly string[],
  exempt: readonly string[] = GOVERNANCE_TRANSPORT_PATHS,
): PathLaw {
  return pathLaw({
    areas: [{ id: "outside_roots", source: "scope", patterns: [...tmvcRoots], overridable: false }],
    rules: [{ id: "forbidden_zone", source: "scope", patterns: [...forbiddenZones], effect: "deny", overridable: false }],
    exempt: [...exempt],
  });
}

/** Transport first, then forbidden zones, then roots (the TMVC order). */
export function classifyRepoRelativePath(
  repoRel: string,
  tmvcRoots: readonly string[],
  forbiddenZones: readonly string[],
): TmvcPathClassification {
  if (isGovernanceTransportPath(repoRel)) return "governance_transport";
  const judged = judgePath(scopePathLaw(tmvcRoots, forbiddenZones), repoRel);
  if (!judged) return "inside_tmvc";
  return judged.rule === "forbidden_zone" ? "forbidden_zone" : "outside_tmvc";
}
