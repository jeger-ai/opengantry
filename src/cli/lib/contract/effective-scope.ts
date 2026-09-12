import { GantryUserError } from "../errors.js";
import { GXT_ERROR } from "../gxt-error-codes.js";
import type { OrgPolicyBundle } from "../policy/policy-types.js";
import { resolveOrgPolicy } from "../policy/policy-resolve.js";
import { resolveManifestSkillKey } from "../skill-key.js";
import { isPathUnderRoot } from "../tmvc-path.js";
import type { Manifest, ParsedMission } from "../types.js";
import { normalizeContract, normalizeContractPath } from "./contract-hash.js";
import type { EffectiveScope, MissionContract } from "./contract-types.js";

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

function unionSorted(...lists: readonly (readonly string[])[]): string[] {
  const out = new Set<string>();
  for (const list of lists) for (const v of list) if (v.trim()) out.add(v);
  return [...out].sort();
}

function assertSubsetOfSkillRoots(contractRoots: readonly string[], skillRoots: readonly string[], skillKey: string): void {
  if (skillRoots.length === 0) return;
  const escaped = contractRoots.filter((r) => !skillRoots.some((s) => isPathUnderRoot(r, s)));
  if (escaped.length === 0) return;
  throw new GantryUserError(
    GXT_ERROR.CONTRACT_SCOPE_ESCAPE,
    `${GXT_ERROR.CONTRACT_SCOPE_ESCAPE}: contract.tmvc_roots must stay inside skill ${skillKey} roots (${skillRoots.join(", ")}); escaped: ${escaped.join(", ")}`,
    "Narrow contract.tmvc_roots to a subset of the manifest skill tmvc_roots, or legislate under a skill that owns those roots.",
    2,
  );
}

function assertRootsOutsideForbidden(contractRoots: readonly string[], forbidden: readonly string[]): void {
  const hits = contractRoots.filter((r) => forbidden.some((fz) => isPathUnderRoot(r, fz)));
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
  const skillKey = resolveManifestSkillKey(input.manifest, input.skillKey);
  const skill = input.manifest.skills[skillKey];
  const skillRoots = (skill?.tmvc_roots ?? []).map(normalizeContractPath);
  const skillForbidden = (skill?.forbidden_zones ?? []).map(normalizeContractPath);
  const contract = input.contract ? normalizeContract(input.contract) : {};
  const policy = input.policy ?? null;

  const policyForbidden = (policy?.manifest_constraints?.forbidden_zones_add ?? []).map(normalizeContractPath);
  const policyBanned = (policy?.banned_imports ?? []).map((b) => b.specifier.trim());

  const forbiddenZones = unionSorted(skillForbidden, contract.forbidden_zones ?? [], policyForbidden);
  const contractRoots = contract.tmvc_roots ?? [];
  assertSubsetOfSkillRoots(contractRoots, skillRoots, skillKey);
  assertRootsOutsideForbidden(contractRoots, forbiddenZones);

  return {
    tmvcRoots: contractRoots.length > 0 ? contractRoots : skillRoots,
    forbiddenZones,
    allowedImports: [...(contract.allowed_imports ?? [])],
    bannedImports: unionSorted(contract.banned_imports ?? [], policyBanned),
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
