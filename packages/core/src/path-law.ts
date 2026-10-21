/**
 * The path law (ADR-0053): one answer to "may this path change, and what happens if it does" for the cage, mission
 * scope and standalone verify. A law is areas plus a rule table; `judgePath` picks the deciding rule, `tightenPathLaw`
 * composes levels so that nothing can widen. Patterns cover a path or any folder above it (core path-glob). Pure.
 */
import { patternCoversPath } from "./path-glob.js";

/** What a consumer does with a hit: deny (fail, revert), planner (only a Planner-stamped commit), report (list it). */
export type PathEffect = "deny" | "planner" | "report";

export interface PathLawRule {
  /** The rule name reports use (`ci_config`, `forbidden_zone`, ...). */
  id: string;
  /** Where the rule comes from (`builtin`, `manifest`, `cage_yaml`, `skill`, `contract`, `org`, ...). */
  source: string;
  patterns: string[];
  /** Covered paths the rule leaves alone. */
  except?: string[];
  effect: PathEffect;
  /** False for rules a runtime override must never relax (the harness itself). */
  overridable: boolean;
}

/** An allowed area: a path no pattern covers is denied under the area's rule name. */
export interface PathLawArea {
  id: string;
  source: string;
  patterns: string[];
  overridable: boolean;
}

export interface PathLaw {
  /** A path must lie inside every area; no areas means everywhere. */
  areas: PathLawArea[];
  /** Table order breaks ties between rules of equal effect; rules come before areas. */
  rules: PathLawRule[];
  /** Governance transport: judged by nothing. Only the top level sets it. */
  exempt: string[];
}

export interface PathJudgment {
  rule: string;
  source: string;
  effect: PathEffect;
  /** The rule pattern that covered the path; null when the path fell outside an area. */
  pattern: string | null;
  /** A runtime override lowered this rule from deny to report. */
  overridden: boolean;
}

const RANK: Record<PathEffect, number> = { deny: 3, planner: 2, report: 1 };

export function pathLaw(partial: Partial<PathLaw> = {}): PathLaw {
  return { areas: [], rules: [], exempt: [], ...partial };
}

const covers = (patterns: readonly string[], path: string): boolean => patterns.some((p) => patternCoversPath(p, path));
const coveringPattern = (patterns: readonly string[], path: string): string | null => patterns.find((p) => patternCoversPath(p, path)) ?? null;

/**
 * The rule that decides the path, or null. Overrides first lower an overridable deny to report, so a non-overridable
 * rule on the same path still decides it; then the strictest effect wins, then table order.
 */
export function judgePath(law: PathLaw, path: string, overrides: readonly string[] = []): PathJudgment | null {
  if (covers(law.exempt, path)) return null;
  const overridden = covers(overrides, path);
  const hits: { id: string; source: string; effect: PathEffect; overridable: boolean; pattern: string | null }[] = [
    ...law.rules.flatMap((r) => {
      const pattern = covers(r.except ?? [], path) ? null : coveringPattern(r.patterns, path);
      return pattern === null ? [] : [{ ...r, pattern }];
    }),
    ...law.areas.filter((a) => !covers(a.patterns, path)).map((a) => ({ ...a, effect: "deny" as const, pattern: null })),
  ];
  let best: PathJudgment | null = null;
  for (const h of hits) {
    const lowered = overridden && h.overridable && h.effect === "deny";
    const j: PathJudgment = { rule: h.id, source: h.source, effect: lowered ? "report" : h.effect, pattern: h.pattern, overridden: lowered };
    if (!best || RANK[j.effect] > RANK[best.effect]) best = j;
  }
  return best;
}

/** Compose levels: rules and areas append (upper first), exemptions stay the upper level's; a lower level only narrows. */
export function tightenPathLaw(upper: PathLaw, lower: Partial<Pick<PathLaw, "areas" | "rules">>): PathLaw {
  return { areas: [...upper.areas, ...(lower.areas ?? [])], rules: [...upper.rules, ...(lower.rules ?? [])], exempt: [...upper.exempt] };
}
