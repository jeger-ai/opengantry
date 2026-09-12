import fs from "node:fs";
import path from "node:path";
import { loadPolicyBundleQuiet } from "./effective-scope.js";
import { normalizeContract, normalizeContractPath } from "./contract-hash.js";
import type { MissionContract } from "./contract-types.js";
import { proposeGate, type ProposedGate } from "./propose-gate.js";
import { proposeImports } from "./propose-imports.js";
import { isPathUnderRoot } from "../tmvc-path.js";
import type { Manifest } from "../types.js";
import type { OrgPolicyBundle as PolicyBundle } from "../policy/policy-types.js";
import { resolveManifestSkillKey } from "../skill-key.js";

export interface ProposeContractInput {
  root: string;
  manifest: Manifest;
  intent: string;
  skillKey: string;
  paths?: string[];
  policy?: PolicyBundle | null;
  gateCommand?: string;
  gateSuccessSubstring?: string;
}

export interface ProposeContractResult {
  contract: MissionContract;
  gate: ProposedGate;
  rationale: string[];
}

const PATH_TOKEN_RE = /(?:\.{0,2}\/)?[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+\/?/g;

function existsRepoPath(root: string, rel: string): boolean {
  return fs.existsSync(path.join(root, rel));
}

function intentPathTokens(intent: string): string[] {
  const out: string[] = [];
  for (const m of intent.matchAll(PATH_TOKEN_RE)) {
    const norm = normalizeContractPath(m[0]!);
    if (norm && !norm.includes("://")) out.push(norm);
  }
  return out;
}

function intersectWithSkillRoots(candidates: readonly string[], skillRoots: readonly string[]): string[] {
  if (skillRoots.length === 0) return [...candidates];
  return candidates.filter((c) => skillRoots.some((s) => isPathUnderRoot(c, s)));
}

function proposeTmvcRoots(input: ProposeContractInput, skillRoots: readonly string[]): { roots: string[]; rationale: string } {
  const hinted = [...intentPathTokens(input.intent), ...(input.paths ?? []).map(normalizeContractPath)];
  const existing = [...new Set(hinted)].filter((p) => existsRepoPath(input.root, p.replace(/\/$/, ""))).sort();
  const narrowed = intersectWithSkillRoots(existing, skillRoots);
  if (narrowed.length > 0) {
    return {
      roots: narrowed,
      rationale: `tmvc_roots from intent/--path that exist on disk (intersect skill roots): ${narrowed.join(", ")}`,
    };
  }
  if (skillRoots.length > 0) {
    return { roots: [...skillRoots].sort(), rationale: `tmvc_roots fallback to skill roots: ${skillRoots.join(", ")}` };
  }
  return { roots: [], rationale: "tmvc_roots empty (substrate skill; Planner must declare roots)" };
}

function proposeForbidden(
  skillForbidden: readonly string[],
  policy: PolicyBundle | null,
  manifest: Manifest,
  proposedRoots: readonly string[],
): { zones: string[]; rationale: string[] } {
  const rationale: string[] = [];
  const policyAdd = (policy?.manifest_constraints?.forbidden_zones_add ?? []).map(normalizeContractPath);
  const tier3: string[] = [];
  for (const [prefix, tier] of Object.entries(manifest.path_risks)) {
    if (tier !== "Tier-3") continue;
    const norm = normalizeContractPath(prefix);
    const covered = proposedRoots.some((r) => isPathUnderRoot(norm, r) || isPathUnderRoot(r, norm));
    if (!covered) tier3.push(norm);
  }
  const zones = [...new Set([...skillForbidden, ...policyAdd, ...tier3])].sort();
  if (skillForbidden.length > 0) rationale.push(`forbidden_zones from skill: ${skillForbidden.join(", ")}`);
  if (policyAdd.length > 0) rationale.push(`forbidden_zones from policy: ${policyAdd.join(", ")}`);
  if (tier3.length > 0) rationale.push(`forbidden_zones from Tier-3 path_risks outside proposed roots: ${tier3.join(", ")}`);
  return { zones, rationale };
}

/**
 * Deterministic contract proposal (ADR-0030: no LLM). Same inputs always yield the same
 * normalized contract, gate, and sorted rationale.
 */
export function proposeContract(input: ProposeContractInput): ProposeContractResult {
  const skillKey = resolveManifestSkillKey(input.manifest, input.skillKey);
  const skill = input.manifest.skills[skillKey];
  const skillRoots = (skill?.tmvc_roots ?? []).map(normalizeContractPath);
  const skillForbidden = (skill?.forbidden_zones ?? []).map(normalizeContractPath);
  const policy = input.policy !== undefined ? input.policy : loadPolicyBundleQuiet(input.root);

  const tmvc = proposeTmvcRoots(input, skillRoots);
  const forbidden = proposeForbidden(skillForbidden, policy, input.manifest, tmvc.roots);
  const imports = proposeImports({
    root: input.root,
    proposedRoots: tmvc.roots,
    forbiddenZones: forbidden.zones,
    policy,
  });
  const gate = proposeGate({
    root: input.root,
    skill,
    proposedRoots: tmvc.roots,
    explicitCommand: input.gateCommand,
    explicitSuccess: input.gateSuccessSubstring,
  });

  const contract = normalizeContract({
    ...(tmvc.roots.length > 0 ? { tmvc_roots: tmvc.roots } : {}),
    forbidden_zones: [...forbidden.zones, ...imports.extraForbidden],
    allowed_imports: imports.allowed_imports,
    banned_imports: imports.banned_imports,
  });

  return {
    contract,
    gate: gate.gate,
    rationale: [tmvc.rationale, ...forbidden.rationale, ...imports.rationale, gate.rationale],
  };
}
