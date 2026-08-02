import type { Manifest, ParsedMission } from "./types.js";
import {
  classifyRepoRelativePath,
  forbiddenZonesForSkill,
  normalizeRepoRelativePath,
  tmvcRootsForSkill,
} from "./tmvc-path.js";

export type ScopeEvaluationKind = "allowed" | "forbidden_zone" | "outside_tmvc";

export interface ScopeEvaluationResult {
  ok: boolean;
  kind: ScopeEvaluationKind;
  repo_rel_path: string;
  skill_key: string;
  message?: string;
}

export interface EvaluateScopeInput {
  manifest: Manifest;
  mission: ParsedMission;
  repoRelPath: string;
}

/** In-memory scope check: TMVC roots and forbidden zones for the mission skill. */
export function evaluateScope(input: EvaluateScopeInput): ScopeEvaluationResult {
  const skillKey = input.mission.skillKey ?? "unknown";
  const norm = normalizeRepoRelativePath(input.repoRelPath);
  const tmvc = tmvcRootsForSkill(input.manifest, skillKey);
  const forbidden = forbiddenZonesForSkill(input.manifest, skillKey);
  const classification = classifyRepoRelativePath(norm, tmvc, forbidden);

  switch (classification) {
    case "forbidden_zone":
      return {
        ok: false,
        kind: "forbidden_zone",
        repo_rel_path: norm,
        skill_key: skillKey,
        message: `path in forbidden zone for skill ${skillKey}`,
      };
    case "outside_tmvc":
      return {
        ok: false,
        kind: "outside_tmvc",
        repo_rel_path: norm,
        skill_key: skillKey,
        message: `path outside TMVC roots for skill ${skillKey}`,
      };
    case "inside_tmvc":
    case "governance_transport":
      return {
        ok: true,
        kind: "allowed",
        repo_rel_path: norm,
        skill_key: skillKey,
      };
    default: {
      const _never: never = classification;
      return _never;
    }
  }
}

/** Match iii function_id against promote-class patterns (deploy, merge, publish, apply, push). */
export function isPromoteClassFunctionId(functionId: string): boolean {
  const id = functionId.toLowerCase();
  return (
    id.includes("::promote") ||
    id.includes("::deploy") ||
    id.includes("::merge") ||
    id.includes("::publish") ||
    id.includes("::apply") ||
    id.includes("::push")
  );
}

export function evaluateFunctionScope(
  manifest: Manifest,
  mission: ParsedMission,
  functionId: string,
): ScopeEvaluationResult {
  const norm = functionId.replace(/::/g, "/");
  return evaluateScope({ manifest, mission, repoRelPath: norm });
}
