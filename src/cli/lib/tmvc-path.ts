import type { Manifest } from "./types.js";

/** Governance transport files — never TMVC drift violations during pre-commit scans. */
export const GOVERNANCE_TRANSPORT_PATHS = [
  "WORKER_LOG.md",
  ".gitagent/missions/.active-mission",
] as const;

export type TmvcPathClassification =
  | "governance_transport"
  | "inside_tmvc"
  | "outside_tmvc"
  | "forbidden_zone";

export function normalizeRepoRelativePath(repoRel: string): string {
  return repoRel.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function isGovernanceTransportPath(repoRel: string): boolean {
  const norm = normalizeRepoRelativePath(repoRel);
  return (GOVERNANCE_TRANSPORT_PATHS as readonly string[]).includes(norm);
}

export function tmvcRootsForSkill(manifest: Manifest, skillKey: string | null): string[] {
  if (!skillKey?.trim()) return [];
  const skill = manifest.skills[skillKey];
  return skill ? [...skill.tmvc_roots] : [];
}

export function forbiddenZonesForSkill(manifest: Manifest, skillKey: string | null): string[] {
  if (!skillKey?.trim()) return [];
  const skill = manifest.skills[skillKey];
  return skill ? [...skill.forbidden_zones] : [];
}

/** True when `repoRel` is exactly `root` or nested under `root/` (POSIX semantics). */
export function isPathUnderRoot(repoRel: string, root: string): boolean {
  const normPath = normalizeRepoRelativePath(repoRel);
  const normRoot = normalizeRepoRelativePath(root).replace(/\/$/, "");
  if (normPath === normRoot) return true;
  return normPath.startsWith(`${normRoot}/`);
}

export function classifyRepoRelativePath(
  repoRel: string,
  tmvcRoots: readonly string[],
  forbiddenZones: readonly string[],
): TmvcPathClassification {
  const norm = normalizeRepoRelativePath(repoRel);
  if (isGovernanceTransportPath(norm)) return "governance_transport";

  for (const fz of forbiddenZones) {
    if (isPathUnderRoot(norm, fz)) return "forbidden_zone";
  }
  for (const root of tmvcRoots) {
    if (isPathUnderRoot(norm, root)) return "inside_tmvc";
  }
  return "outside_tmvc";
}
