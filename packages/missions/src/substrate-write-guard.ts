import { normalizeRepoRelativePath } from "#core/posix-path.js";
import { judgePath, pathLaw } from "#core/path-law.js";
import { REL_MISSIONS_PREFIX } from "./git/git-proof.js";
import { classifyScopePath, forbiddenZoneRules, skillScopeLaw } from "./scope-law.js";
import { GantryUserError } from "#core/user-error.js";
import type { Manifest } from "#core/manifest.js";

export const MCP_WRITE_DENIED = "MCP_WRITE_DENIED" as const;

export class McpWriteDeniedError extends GantryUserError {
  readonly repoRelPath: string;

  constructor(repoRelPath: string, reason: string) {
    const norm = normalizeRepoRelativePath(repoRelPath);
    super(MCP_WRITE_DENIED, `MCP write denied: ${reason} (${norm})`);
    this.repoRelPath = norm;
  }
}

function assertNoPathTraversal(repoRel: string): void {
  const norm = normalizeRepoRelativePath(repoRel);
  if (norm.includes("..") || norm.startsWith("/")) {
    throw new McpWriteDeniedError(norm, "path must be repo-relative without traversal");
  }
}

/** Mission file writes via MCP must stay under `.gitagent/missions/`. */
export function assertMcpMissionWritePath(repoRelPath: string): void {
  assertNoPathTraversal(repoRelPath);
  const norm = normalizeRepoRelativePath(repoRelPath);
  if (!norm.startsWith(REL_MISSIONS_PREFIX)) {
    throw new McpWriteDeniedError(
      norm,
      `mission writes must stay under ${REL_MISSIONS_PREFIX}`,
    );
  }
}

function allManifestForbiddenZones(manifest: Manifest): string[] {
  const zones = new Set<string>();
  for (const skill of Object.values(manifest.skills)) {
    for (const fz of skill.forbidden_zones ?? []) {
      zones.add(fz);
    }
  }
  return [...zones];
}

/**
 * Validate a repo-relative write target for a skill-scoped MCP mutation against the skill's law: governance
 * transport is always allowed, a forbidden zone names its pattern, anything outside the roots is denied.
 */
export function assertMcpSkillWritePath(
  manifest: Manifest,
  skillKey: string,
  repoRelPath: string,
): void {
  assertNoPathTraversal(repoRelPath);
  const norm = normalizeRepoRelativePath(repoRelPath);
  const law = skillScopeLaw(manifest, skillKey);
  switch (classifyScopePath(law, norm)) {
    case "forbidden_zone":
      throw new McpWriteDeniedError(norm, `path in forbidden zone ${judgePath(law, norm)?.pattern ?? ""}`);
    case "outside_tmvc":
      throw new McpWriteDeniedError(norm, `path outside TMVC roots for skill ${skillKey}`);
    default:
      return;
  }
}

/**
 * Tier-3 substrate upgrade: each `planned_writes` entry is Planner-authorized via signed mission.
 * Deny forbidden-zone targets not explicitly listed in `planned_writes`.
 */
export function assertMcpSubstrateUpgradeWritePaths(
  manifest: Manifest,
  plannedWrites: readonly string[],
): void {
  const authorized = new Set(plannedWrites.map((p) => normalizeRepoRelativePath(p)));
  const zones = pathLaw({ rules: forbiddenZoneRules("manifest", allManifestForbiddenZones(manifest)) });

  for (const relPath of plannedWrites) {
    assertNoPathTraversal(relPath);
    const norm = normalizeRepoRelativePath(relPath);
    const hit = judgePath(zones, norm)?.pattern ?? null;
    if (hit && !authorized.has(norm)) {
      throw new McpWriteDeniedError(norm, `forbidden zone ${hit} not authorized by upgrade mission`);
    }
  }
}
