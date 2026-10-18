/**
 * The law model (ADR-0052 A2, A3). A `Law` is what one level of the flight-level ladder allows and forbids:
 * where an executor may write (allowed roots), where nobody may write (forbidden zones), what only a Planner-stamped
 * commit may change (protected paths), and the import discipline a contract adds. `tighten` composes two levels
 * (RULES §4, §8, ADR-0049): sets are unioned, roots may only narrow, tiers take the maximum. `evaluatePaths` judges a
 * `ChangeSet` (staged paths, a commit range, a worktree, or one write) against a law. Pure: no fs, git or process.
 */
import { pathMatchesPerimeterGlob } from "./path-glob.js";

export type RiskTier = "Tier-1" | "Tier-2" | "Tier-3";

const TIER_RANK: Record<RiskTier, number> = { "Tier-1": 1, "Tier-2": 2, "Tier-3": 3 };

export interface Law {
  /** Risk tier of the work this law governs; `tighten` keeps the stricter one. */
  tier: RiskTier | null;
  /** Repo-relative roots an executor may edit (a path is inside when it equals a root or sits under `root/`). */
  allowedRoots: string[];
  /** Repo-relative paths nobody may edit under this law; same prefix semantics as roots. */
  forbiddenZones: string[];
  /** Perimeter globs (`**\/suffix` or exact) that only a Planner-stamped commit may change. */
  protectedPaths: string[];
  /** Paths exempt from root and forbidden-zone classification (governance transport such as EXECUTOR_LOG.md). */
  transportPaths: string[];
  /** Bare-specifier allowlist for imports; empty means no allowlist. */
  allowedImports: string[];
  /** Bare specifiers (exact or prefix) no file under the roots may import. */
  bannedImports: string[];
  allowDynamicSpecifiers: boolean;
  strictRelativeImports: boolean;
}

export function emptyLaw(): Law {
  return {
    tier: null,
    allowedRoots: [],
    forbiddenZones: [],
    protectedPaths: [],
    transportPaths: [],
    allowedImports: [],
    bannedImports: [],
    allowDynamicSpecifiers: false,
    strictRelativeImports: false,
  };
}

export function law(partial: Partial<Law>): Law {
  return { ...emptyLaw(), ...partial };
}

/** Repo-relative POSIX form: backslashes to slashes, no leading `./`. */
export function normalizeRepoRelativePath(repoRel: string): string {
  return repoRel.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** True when `repoRel` is exactly `root` or nested under `root/` (POSIX semantics). */
export function isPathUnderRoot(repoRel: string, root: string): boolean {
  const normPath = normalizeRepoRelativePath(repoRel);
  const normRoot = normalizeRepoRelativePath(root).replace(/\/$/, "");
  if (normPath === normRoot) return true;
  return normPath.startsWith(`${normRoot}/`);
}

/** Sorted set union of non-blank entries (the order every law set is kept in). */
export function unionSorted(...lists: readonly (readonly string[])[]): string[] {
  const out = new Set<string>();
  for (const list of lists) for (const v of list) if (v.trim()) out.add(v);
  return [...out].sort();
}

export type TightenViolationKind = "roots_escape" | "roots_in_forbidden";

export interface TightenViolation {
  kind: TightenViolationKind;
  /** The lower-level roots that widen the upper law or sit in a forbidden zone. */
  paths: string[];
}

export interface TightenResult {
  law: Law;
  /** Empty when the lower law only narrows the upper one. Callers decide how to report. */
  violations: TightenViolation[];
}

function strictestTier(a: RiskTier | null, b: RiskTier | null): RiskTier | null {
  if (!a) return b;
  if (!b) return a;
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

/**
 * Compose an upper law with a lower one (RULES §4, §8; ADR-0049 §2). Forbidden zones, protected paths, transport
 * paths and banned imports are unioned; allowed imports and the import switches come from the lower law when it
 * sets them; the tier is the stricter one. Roots: the lower roots replace the upper ones only when every lower root
 * sits inside an upper root (an upper law with no roots accepts any lower roots, RULES §4); roots inside the merged
 * forbidden zones are reported too. Violations are returned, never thrown, so each caller keeps its own error code.
 */
export function tighten(upper: Law, lower: Partial<Law>): TightenResult {
  const lowerRoots = (lower.allowedRoots ?? []).map(normalizeRepoRelativePath);
  const upperRoots = upper.allowedRoots.map(normalizeRepoRelativePath);
  const forbiddenZones = unionSorted(upper.forbiddenZones, lower.forbiddenZones ?? []);
  const violations: TightenViolation[] = [];
  if (upperRoots.length > 0) {
    const escaped = lowerRoots.filter((r) => !upperRoots.some((u) => isPathUnderRoot(r, u)));
    if (escaped.length > 0) violations.push({ kind: "roots_escape", paths: escaped });
  }
  const inForbidden = lowerRoots.filter((r) => forbiddenZones.some((fz) => isPathUnderRoot(r, fz)));
  if (inForbidden.length > 0) violations.push({ kind: "roots_in_forbidden", paths: inForbidden });
  return {
    law: {
      tier: strictestTier(upper.tier, lower.tier ?? null),
      allowedRoots: lowerRoots.length > 0 ? lowerRoots : upperRoots,
      forbiddenZones,
      protectedPaths: unionSorted(upper.protectedPaths, lower.protectedPaths ?? []),
      transportPaths: unionSorted(upper.transportPaths, lower.transportPaths ?? []),
      allowedImports: lower.allowedImports && lower.allowedImports.length > 0 ? [...lower.allowedImports] : [...upper.allowedImports],
      bannedImports: unionSorted(upper.bannedImports, lower.bannedImports ?? []),
      allowDynamicSpecifiers: lower.allowDynamicSpecifiers ?? upper.allowDynamicSpecifiers,
      strictRelativeImports: lower.strictRelativeImports ?? upper.strictRelativeImports,
    },
    violations,
  };
}

export type PathClass = "transport" | "forbidden_zone" | "inside_roots" | "outside_roots";

/** Where a path stands under a law: transport first, then forbidden zones, then roots (the TMVC order). */
export function classifyPath(lawOf: Law, repoRel: string): PathClass {
  const norm = normalizeRepoRelativePath(repoRel);
  if (lawOf.transportPaths.some((t) => normalizeRepoRelativePath(t) === norm)) return "transport";
  for (const fz of lawOf.forbiddenZones) if (isPathUnderRoot(norm, fz)) return "forbidden_zone";
  for (const root of lawOf.allowedRoots) if (isPathUnderRoot(norm, root)) return "inside_roots";
  return "outside_roots";
}

/** True when a perimeter glob of the law protects the path. */
export function isProtectedPath(lawOf: Law, repoRel: string): boolean {
  return lawOf.protectedPaths.some((g) => pathMatchesPerimeterGlob(repoRel, g));
}

export type ChangeSetKind = "staged" | "range" | "worktree" | "write";

/** The paths a judgment is about, and where they came from. Built by the git or fs adapters, judged here. */
export interface ChangeSet {
  kind: ChangeSetKind;
  /** Repo-relative paths, any separator; normalized when judged. */
  paths: string[];
  base?: string;
  head?: string;
}

export type PathRule = "forbidden_zone" | "outside_roots" | "protected_path";

export interface PathFinding {
  rule: PathRule;
  path: string;
}

export interface EvaluatePathsOptions {
  /** Report paths outside the allowed roots (default true; false when the law has no roots to enforce). */
  roots?: boolean;
  /** Report protected paths (default false; the perimeter check decides what a hit means). */
  protectedPaths?: boolean;
}

/** Judge every path of a change set against a law. Order follows the change set; one finding per path. */
export function evaluatePaths(lawOf: Law, change: ChangeSet, options: EvaluatePathsOptions = {}): PathFinding[] {
  const roots = options.roots ?? true;
  const findings: PathFinding[] = [];
  for (const raw of change.paths) {
    const path = normalizeRepoRelativePath(raw);
    const cls = classifyPath(lawOf, path);
    if (cls === "forbidden_zone") findings.push({ rule: "forbidden_zone", path });
    else if (cls === "outside_roots" && roots) findings.push({ rule: "outside_roots", path });
    else if (options.protectedPaths && isProtectedPath(lawOf, path)) findings.push({ rule: "protected_path", path });
  }
  return findings;
}
