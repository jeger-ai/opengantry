import { REL_MISSIONS_PREFIX } from "./git-proof.js";
import {
  classifyRepoRelativePath,
  forbiddenZonesForSkill,
  isGovernanceTransportPath,
  isPathUnderRoot,
  normalizeRepoRelativePath,
  tmvcRootsForSkill,
} from "./tmvc-path.js";
import { GantryUserError } from "./errors.js";
import type { Manifest } from "./types.js";
import { resolveManifestSkillKey } from "./skill-key.js";

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

function pathHitsForbiddenZone(repoRel: string, forbiddenZones: readonly string[]): string | null {
  const norm = normalizeRepoRelativePath(repoRel);
  for (const fz of forbiddenZones) {
    if (isPathUnderRoot(norm, fz)) return fz;
  }
  return null;
}

/**
 * Validate a repo-relative write target for a skill-scoped MCP mutation.
 * Governance transport paths (EXECUTOR_LOG, active-mission pin) are always allowed.
 */
export function assertMcpSkillWritePath(
  manifest: Manifest,
  skillKey: string,
  repoRelPath: string,
): void {
  assertNoPathTraversal(repoRelPath);
  const norm = normalizeRepoRelativePath(repoRelPath);
  if (isGovernanceTransportPath(norm)) return;

  const resolvedSkill = resolveManifestSkillKey(manifest, skillKey);
  const forbidden = forbiddenZonesForSkill(manifest, resolvedSkill);
  const hit = pathHitsForbiddenZone(norm, forbidden);
  if (hit) {
    throw new McpWriteDeniedError(norm, `path in forbidden zone ${hit}`);
  }

  const tmvc = tmvcRootsForSkill(manifest, resolvedSkill);
  const classification = classifyRepoRelativePath(norm, tmvc, forbidden);
  if (classification === "inside_tmvc" || classification === "governance_transport") return;

  throw new McpWriteDeniedError(norm, `path outside TMVC roots for skill ${resolvedSkill}`);
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
  const allForbidden = allManifestForbiddenZones(manifest);

  for (const relPath of plannedWrites) {
    assertNoPathTraversal(relPath);
    const norm = normalizeRepoRelativePath(relPath);
    const hit = pathHitsForbiddenZone(norm, allForbidden);
    if (hit && !authorized.has(norm)) {
      throw new McpWriteDeniedError(norm, `forbidden zone ${hit} not authorized by upgrade mission`);
    }
  }
}
