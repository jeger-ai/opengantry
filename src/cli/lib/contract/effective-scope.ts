import { GantryUserError } from "../errors.js";
import { GXT_ERROR } from "#core/error-codes.js";
import type { OrgPolicyBundle } from "#plane/policy-types.js";
import { resolveOrgPolicy } from "../policy/policy-resolve.js";
import { resolveManifestSkillKey } from "../skill-key.js";
import { law, tighten } from "#core/law.js";
import type { Manifest, ParsedMission } from "#core/mission-types.js";
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
  const skillKey = resolveManifestSkillKey(input.manifest, input.skillKey);
  const skill = input.manifest.skills[skillKey];
  const skillRoots = (skill?.tmvc_roots ?? []).map(normalizeContractPath);
  const skillForbidden = (skill?.forbidden_zones ?? []).map(normalizeContractPath);
  const contract = input.contract ? normalizeContract(input.contract) : {};
  const policy = input.policy ?? null;

  const policyForbidden = (policy?.manifest_constraints?.forbidden_zones_add ?? []).map(normalizeContractPath);
  const policyBanned = (policy?.banned_imports ?? []).map((b) => b.specifier.trim());

  // Level 1 (skill) tightened by the org floor (policy forbidden zones and banned imports), then by level 0 (contract).
  const floor = tighten(law({ allowedRoots: skillRoots, forbiddenZones: skillForbidden }), { forbiddenZones: policyForbidden, bannedImports: policyBanned }).law;
  const merged = tighten(floor, {
    allowedRoots: contract.tmvc_roots ?? [],
    forbiddenZones: contract.forbidden_zones ?? [],
    allowedImports: contract.allowed_imports ?? [],
    bannedImports: contract.banned_imports ?? [],
    allowDynamicSpecifiers: contract.allow_dynamic_specifiers === true,
    strictRelativeImports: contract.strict_relative_imports === true,
  });
  assertSubsetOfSkillRoots(merged.violations.find((v) => v.kind === "roots_escape")?.paths ?? [], skillRoots, skillKey);
  assertRootsOutsideForbidden(merged.violations.find((v) => v.kind === "roots_in_forbidden")?.paths ?? []);

  return {
    tmvcRoots: merged.law.allowedRoots,
    forbiddenZones: merged.law.forbiddenZones,
    allowedImports: merged.law.allowedImports,
    bannedImports: merged.law.bannedImports,
    allowDynamicSpecifiers: merged.law.allowDynamicSpecifiers,
    strictRelativeImports: merged.law.strictRelativeImports,
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
