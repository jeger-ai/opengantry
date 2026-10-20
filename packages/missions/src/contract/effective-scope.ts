import { GantryUserError } from "#core/user-error.js";
import { GXT_ERROR } from "#core/error-codes.js";
import type { OrgPolicyBundle } from "#plane/policy-types.js";
import { resolveOrgPolicy } from "#plane/policy-resolve.js";
import { isPathUnderRoot, unionSorted } from "#core/law.js";
import { normalizeRepoRelativePath } from "#core/posix-path.js";
import type { Manifest } from "#core/manifest.js";
import type { ParsedMission } from "#core/mission-types.js";
import { normalizeContract, normalizeContractPath } from "./contract-hash.js";
import type { EffectiveScope, MissionContract } from "#core/contract-types.js";

export interface ResolveEffectiveScopeInput {
  manifest: Manifest;
  skillKey: string;
  contract: MissionContract | null;
  /** Cached org policy bundle (ADR-0042); null when absent or unreadable. */
  policy?: OrgPolicyBundle | null;
}

/** Best-effort offline policy bundle; verify's policy phase owns failure reporting. */
export function loadPolicyBundleQuiet(root: string): OrgPolicyBundle | null {
  const resolved = resolveOrgPolicy(root);
  if (!resolved.ok || !resolved.present) return null;
  return resolved.bundle;
}

function assertSubsetOfSkillRoots(escaped: readonly string[], skillRoots: readonly string[], skillKey: string): void {
  if (escaped.length === 0) return;
  throw new GantryUserError(
    GXT_ERROR.CONTRACT_SCOPE_ESCAPE,
    `${GXT_ERROR.CONTRACT_SCOPE_ESCAPE}: contract.tmvc_roots must stay inside skill ${skillKey} roots (${skillRoots.join(", ")}); escaped: ${escaped.join(", ")}`,
    "Narrow contract.tmvc_roots to a subset of the manifest skill tmvc_roots, or legislate under a skill that owns those roots.",
    2,
  );
}

function assertRootsOutsideForbidden(hits: readonly string[]): void {
  if (hits.length === 0) return;
  throw new GantryUserError(
    GXT_ERROR.CONTRACT_SCOPE_ESCAPE,
    `${GXT_ERROR.CONTRACT_SCOPE_ESCAPE}: contract.tmvc_roots overlap forbidden zones: ${hits.join(", ")}`,
    "Remove the forbidden path from contract.tmvc_roots; forbidden zones are tighten-only and cannot be re-opened by a mission.",
    2,
  );
}

/**
 * Tighten-only merge (RULES §4, §8): TMVC = contract narrowing or skill roots; forbidden zones and
 * banned imports are unions of skill, contract, and policy. Throws GXT_CONTRACT_SCOPE_ESCAPE when the
 * contract tries to widen scope.
 */
export function resolveEffectiveScope(input: ResolveEffectiveScopeInput): EffectiveScope {
  const skillKey = input.skillKey;
  const skill = input.manifest.skills[skillKey];
  const skillRoots = (skill?.tmvc_roots ?? []).map(normalizeContractPath);
  const skillForbidden = (skill?.forbidden_zones ?? []).map(normalizeContractPath);
  const contract = input.contract ? normalizeContract(input.contract) : {};
  const policy = input.policy ?? null;

  const policyForbidden = (policy?.manifest_constraints?.forbidden_zones_add ?? []).map(normalizeContractPath);
  const policyBanned = (policy?.banned_imports ?? []).map((b) => b.specifier.trim());

  // Level 1 (skill), the org floor (policy zones and banned imports), then level 0 (contract). The contract's roots
  // narrow the skill's: they must sit inside them (an empty skill root list accepts any), so the contract area is
  // the intersection of both (ADR-0053 decision 1). Sets are unioned; nothing widens.
  const skillRootsNorm = skillRoots.map(normalizeRepoRelativePath);
  const contractRoots = (contract.tmvc_roots ?? []).map(normalizeRepoRelativePath);
  const forbiddenZones = unionSorted(skillForbidden, policyForbidden, contract.forbidden_zones ?? []);
  const escaped = skillRootsNorm.length > 0 ? contractRoots.filter((r) => !skillRootsNorm.some((u) => isPathUnderRoot(r, u))) : [];
  assertSubsetOfSkillRoots(escaped, skillRoots, skillKey);
  assertRootsOutsideForbidden(contractRoots.filter((r) => forbiddenZones.some((fz) => isPathUnderRoot(r, fz))));

  return {
    tmvcRoots: contractRoots.length > 0 ? contractRoots : skillRootsNorm,
    forbiddenZones,
    allowedImports: [...(contract.allowed_imports ?? [])],
    bannedImports: unionSorted(policyBanned, contract.banned_imports ?? []),
    allowDynamicSpecifiers: contract.allow_dynamic_specifiers === true,
    strictRelativeImports: contract.strict_relative_imports === true,
    hasContract: input.contract !== null,
  };
}

/** Convenience for callers holding a parsed mission and repo root (loads policy quietly). */
export function resolveEffectiveScopeForMission(root: string, manifest: Manifest, mission: ParsedMission): EffectiveScope {
  const skillKey = mission.skillKey?.trim();
  if (!skillKey) {
    throw new GantryUserError("MISSION_SCHEMA_INVALID", `mission missing skill_key (${mission.rawPath})`, undefined, 2);
  }
  return resolveEffectiveScope({
    manifest,
    skillKey,
    contract: mission.contract,
    policy: loadPolicyBundleQuiet(root),
  });
}
