/**
 * The scope law (ADR-0053 decisions 1 and 2): the manifest, the org floor and a mission's contract become the one
 * PathLaw every mission-side consumer judges with; levels compose through tightenPathLaw, so nothing widens. Pure.
 */
import type { Manifest } from "#core/manifest.js";
import type { MissionContract } from "#core/contract-types.js";
import type { OrgPolicyBundle } from "#plane/policy-types.js";
import { patternCoversPath } from "#core/path-glob.js";
import { judgePath, pathLaw, tightenPathLaw, type PathLaw, type PathLawRule } from "#core/path-law.js";

/** Governance transport: written by every mission, judged by nothing. */
const GOVERNANCE_TRANSPORT_PATHS = ["EXECUTOR_LOG.md", ".gitagent/missions/.active-mission"] as const;

export const DEFAULT_PERIMETER_PROTECTED = [
  "**/.gxt-skill.yaml",
  ".gitagent/foreman/MANIFEST.yaml",
  ".gitagent/foreman/MANIFEST.json",
  ".gitagent/planner/RULES.md",
] as const;

/** Forbidden zones of one level as deny rules; the rule name is what reports and guards say. */
export function forbiddenZoneRules(source: string, zones: readonly string[]): PathLawRule[] {
  return zones.length === 0 ? [] : [{ id: "forbidden_zone", source, patterns: [...zones], effect: "deny", overridable: false }];
}

/** The perimeter as planner rules: the manifest's `perimeter_protected` (or the defaults), then the org floor's additions (ADR-0042). */
function perimeterRules(manifest: Manifest, policy: OrgPolicyBundle | null): PathLawRule[] {
  const own = manifest.perimeter_protected?.length ? manifest.perimeter_protected : DEFAULT_PERIMETER_PROTECTED;
  const rule = (source: string, patterns: readonly string[]): PathLawRule[] =>
    patterns.length === 0 ? [] : [{ id: "protected_path", source, patterns: [...patterns], effect: "planner", overridable: false }];
  return [...rule("manifest", own), ...rule("org", policy?.manifest_constraints?.perimeter_protected_add ?? [])];
}

/** The perimeter alone (gantry perimeter, trusted automation's hard deny). */
export function perimeterLaw(manifest: Manifest, policy: OrgPolicyBundle | null): PathLaw {
  return pathLaw({ rules: perimeterRules(manifest, policy) });
}

/** One level: roots as an area (no roots denies every path, so an unknown skill may change nothing) and zones as deny rules. */
function scopeLevel(source: string, roots: readonly string[], zones: readonly string[]): Pick<PathLaw, "areas" | "rules"> {
  return {
    areas: [{ id: "outside_roots", source, patterns: [...roots], overridable: false }],
    rules: forbiddenZoneRules(source, zones),
  };
}

/** The skill's law: its roots and zones, the org floor's zones, the perimeter, governance transport exempt. */
export function skillScopeLaw(manifest: Manifest, skillKey: string | null, policy: OrgPolicyBundle | null = null): PathLaw {
  const skill = skillKey?.trim() ? manifest.skills[skillKey.trim()] : undefined;
  const level = scopeLevel("skill", skill?.tmvc_roots ?? [], skill?.forbidden_zones ?? []);
  const upper = pathLaw({ ...level, rules: [...level.rules, ...perimeterRules(manifest, policy)], exempt: [...GOVERNANCE_TRANSPORT_PATHS] });
  return tightenPathLaw(upper, { rules: forbiddenZoneRules("org", policy?.manifest_constraints?.forbidden_zones_add ?? []) });
}

/** The mission's law: the skill law tightened by the contract; contract roots are a second area (areas intersect, decision 1). */
export function missionScopeLaw(
  manifest: Manifest,
  skillKey: string,
  policy: OrgPolicyBundle | null,
  contract: Pick<MissionContract, "tmvc_roots" | "forbidden_zones"> | null,
): PathLaw {
  const upper = skillScopeLaw(manifest, skillKey, policy);
  const roots = contract?.tmvc_roots ?? [];
  const lower = scopeLevel("contract", roots, contract?.forbidden_zones ?? []);
  return tightenPathLaw(upper, { areas: roots.length > 0 ? lower.areas : [], rules: lower.rules });
}

/** A path's standing under a scope law, in the TMVC vocabulary. */
export type TmvcPathClassification = "governance_transport" | "inside_tmvc" | "outside_tmvc" | "forbidden_zone";

/** Transport first, then zones, then roots. A planner rule counts as inside: the perimeter check decides those per commit. */
export function classifyScopePath(law: PathLaw, repoRel: string): TmvcPathClassification {
  if (law.exempt.some((p) => patternCoversPath(p, repoRel))) return "governance_transport";
  const judged = judgePath(law, repoRel);
  if (!judged || judged.effect !== "deny") return "inside_tmvc";
  return judged.rule === "forbidden_zone" ? "forbidden_zone" : "outside_tmvc";
}
