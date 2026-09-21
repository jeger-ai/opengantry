import { normalizeContractPath } from "./contract-hash.js";
import { existingHintedPaths } from "./intent-path-tokens.js";
import { PREFLIGHT_MIN_CONFIDENCE, type PreflightResult, type TmvcRootCandidate } from "./preflight-types.js";
import { isTriageEscalated, triageIntent } from "../triage-logic.js";
import type { Manifest } from "../types.js";

export interface HeuristicPreflightInput {
  root: string;
  manifest: Manifest;
  intent: string;
  paths?: string[];
}

function skillRootsFor(manifest: Manifest, skillKey: string | null): string[] {
  if (!skillKey) return [];
  return (manifest.skills[skillKey]?.tmvc_roots ?? []).map(normalizeContractPath);
}

function candidateScores(paths: readonly string[]): TmvcRootCandidate[] {
  return paths.map((path) => ({ path, score: 1 }));
}

function emitSkillKey(skillKey: string | null, confidence: number, escalate: boolean): string | null {
  if (escalate || skillKey === null || skillKey === "NONE") return null;
  if (confidence < PREFLIGHT_MIN_CONFIDENCE) return null;
  return skillKey;
}

/** Offline skill/path classifier. Never calls a network. */
export function runHeuristicPreflight(input: HeuristicPreflightInput): PreflightResult {
  const triage = triageIntent(input.root, input.intent, input.manifest);
  const escalate = isTriageEscalated(triage);
  const resolved = escalate ? null : triage.skill_key === "NONE" ? null : triage.skill_key;
  const roots = skillRootsFor(input.manifest, resolved);
  const hinted = existingHintedPaths(input.root, input.intent, input.paths, roots);
  const tmvc_root_candidates =
    hinted.length > 0 ? candidateScores(hinted) : candidateScores([...roots].sort());
  const rationale = [...triage.match_reasons, triage.reason];
  return {
    provider: "heuristic",
    skill_key: emitSkillKey(resolved, triage.confidence, escalate),
    skill_confidence: triage.confidence,
    tmvc_root_candidates,
    escalate,
    rationale,
  };
}
