import {
  classifyRepoRelativePath,
  forbiddenZonesForSkill,
  normalizeRepoRelativePath,
  tmvcRootsForSkill,
  type TmvcPathClassification,
} from "./tmvc-path.js";
import { gitStagedNameOnly } from "./git-staged.js";
import type { Manifest } from "./types.js";

export interface StagedTmvcViolation {
  path: string;
  classification: Exclude<TmvcPathClassification, "governance_transport" | "inside_tmvc">;
}

export interface StagedTmvcGuardResult {
  ok: boolean;
  skipped: boolean;
  skipReason?: string;
  violations: StagedTmvcViolation[];
  stagedPaths: string[];
  tmvcRoots: string[];
  forbiddenZones: string[];
}

export interface StagedTmvcGuardOptions {
  repoRoot: string;
  manifest: Manifest;
  skillKey: string | null;
  /** When true, no mission/skill context — caller should treat as skip. */
  noMission?: boolean;
}

function toViolation(
  repoRel: string,
  classification: TmvcPathClassification,
): StagedTmvcViolation | null {
  if (classification === "governance_transport" || classification === "inside_tmvc") {
    return null;
  }
  return { path: repoRel, classification };
}

/** Evaluate staged index paths against mission TMVC roots (path metadata only). */
export function evaluateStagedTmvcGuard(options: StagedTmvcGuardOptions): StagedTmvcGuardResult {
  if (options.noMission === true) {
    return {
      ok: true,
      skipped: true,
      skipReason: "no pinned mission",
      violations: [],
      stagedPaths: [],
      tmvcRoots: [],
      forbiddenZones: [],
    };
  }

  const tmvcRoots = tmvcRootsForSkill(options.manifest, options.skillKey);
  const forbiddenZones = forbiddenZonesForSkill(options.manifest, options.skillKey);
  const stagedPaths = gitStagedNameOnly(options.repoRoot).map(normalizeRepoRelativePath);

  const violations: StagedTmvcViolation[] = [];
  for (const repoRel of stagedPaths) {
    const classification = classifyRepoRelativePath(repoRel, tmvcRoots, forbiddenZones);
    const violation = toViolation(repoRel, classification);
    if (violation) violations.push(violation);
  }

  return {
    ok: violations.length === 0,
    skipped: false,
    violations,
    stagedPaths,
    tmvcRoots,
    forbiddenZones,
  };
}

export function formatStagedTmvcAdvisory(result: StagedTmvcGuardResult): string[] {
  if (result.skipped) {
    return [`tmvc guard: skipped (${result.skipReason ?? "unknown"})`];
  }
  if (result.violations.length === 0) {
    return ["tmvc guard: OK — all staged paths within TMVC roots"];
  }
  const lines = [
    `tmvc guard: ${String(result.violations.length)} staged path(s) outside TMVC roots or in forbidden zones:`,
  ];
  for (const v of result.violations) {
    const label = v.classification === "forbidden_zone" ? "FORBIDDEN" : "OUTSIDE_TMVC";
    lines.push(`  [${label}] ${v.path}`);
  }
  lines.push("Record a Context Request in WORKER_LOG.md before editing outside TMVC (gantry context-request).");
  return lines;
}
