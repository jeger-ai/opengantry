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

// ---------------------------------------------------------------------------------------------------------------
// Import discipline (contract: ADR-0045) and architecture rules (TARGET_ARCHITECTURE: ADR-0024), judged per site.

import { importMatchesBan, type SpecifierClass } from "./specifier.js";
import { pathMatchesGlobPattern } from "./path-glob.js";

export type ImportFindingKind = "banned" | "unlisted" | "dynamic" | "scope_escape";

export interface ImportFinding {
  kind: ImportFindingKind;
  /** Repo-relative importing file. */
  file: string;
  line: number;
  column: number;
  /** Specifier text, or the raw expression for dynamic sites. */
  specifier: string;
  detail: string;
}

/** The subset of an import site the law needs: a literal specifier, or null for a dynamic expression. */
export interface ImportSiteLike {
  kind: string;
  spec: string | null;
  expression?: string;
  line: number;
  column: number;
}

function importFinding(kind: ImportFindingKind, file: string, site: ImportSiteLike, specifier: string, detail: string): ImportFinding {
  return { kind, file, line: site.line, column: site.column, specifier, detail };
}

/**
 * Judge one import site against a law's import discipline: dynamic specifiers, banned and unlisted bare
 * packages, and relative or alias imports resolving into a forbidden zone or (strict mode) outside the roots.
 * `classified` is the site's specifier classification (null for a dynamic site); builtins always pass.
 */
export function evaluateImportSite(lawOf: Law, file: string, site: ImportSiteLike, classified: SpecifierClass | null): ImportFinding | null {
  if (site.spec === null || classified === null) {
    if (lawOf.allowDynamicSpecifiers) return null;
    const call = site.kind === "require_expr" ? "require" : "import";
    return importFinding("dynamic", file, site, site.expression ?? "", `non-literal ${call}(${site.expression ?? ""}) is not allowed (contract.allow_dynamic_specifiers=false)`);
  }
  switch (classified.kind) {
    case "builtin":
      return null;
    case "bare": {
      const spec = classified.specifier;
      const banned = lawOf.bannedImports.find((b) => importMatchesBan(spec, b));
      if (banned) return importFinding("banned", file, site, spec, `import of banned specifier "${spec}" (banned: ${banned})`);
      if (lawOf.allowedImports.length > 0 && !lawOf.allowedImports.some((a) => importMatchesBan(spec, a))) {
        return importFinding("unlisted", file, site, spec, `import "${spec}" is not in contract.allowed_imports`);
      }
      return null;
    }
    case "relative":
    case "alias": {
      const resolved = classified.resolvedRepoRel;
      const forbidden = lawOf.forbiddenZones.find((fz) => isPathUnderRoot(resolved, fz));
      if (forbidden) return importFinding("scope_escape", file, site, classified.specifier, `import resolves into forbidden zone ${forbidden} (${resolved})`);
      if (lawOf.strictRelativeImports && lawOf.allowedRoots.length > 0 && !lawOf.allowedRoots.some((r) => isPathUnderRoot(resolved, r))) {
        return importFinding("scope_escape", file, site, classified.specifier, `import resolves outside effective TMVC roots (${resolved})`);
      }
      return null;
    }
    default: {
      const _exhaustive: never = classified;
      return _exhaustive;
    }
  }
}

/** A named set of files (arch glob dialect: `prefix/**` or exact). */
export interface Layer {
  id: string;
  globs: string[];
}

export interface LayerImportRule {
  id: string;
  from_layer: string;
  applies_to?: string[];
  forbid_import_layer?: string;
  forbid_specifier_substring?: string;
  forbid_resolved_path_substring?: string;
}

export interface PatternRule {
  id: string;
  /** Kept for the record; pattern rules apply by `applies_to` or the scan roots, not by layer. */
  from_layer: string;
  applies_to?: string[];
  forbid_pattern?: string;
  require_pattern?: string;
}

/** A hit of a layer import rule or a pattern rule (the `gantry arch check` row). */
export interface LayerFinding {
  file: string;
  rule_id: string;
  module_specifier: string;
  bindings: string[];
  line: number;
  column: number;
}

export interface ArchLaw {
  layers: Layer[];
  layerImportRules: LayerImportRule[];
  patternRules: PatternRule[];
}

export function archLaw(partial: Partial<ArchLaw>): ArchLaw {
  return { layers: [], layerImportRules: [], patternRules: [], ...partial };
}

/** The first layer whose glob matches the file (general glob: `**`, `*`, `?`), else `other`. */
export function layerForFile(arch: ArchLaw, repoRel: string): string {
  const norm = normalizeRepoRelativePath(repoRel);
  for (const layer of arch.layers) {
    for (const glob of layer.globs) if (pathMatchesGlobPattern(norm, normalizeRepoRelativePath(glob))) return layer.id;
  }
  return "other";
}

export interface LayerImport {
  spec: string;
  line: number;
  column: number;
  bindings: string[];
  /** Repo-relative resolution of a relative specifier, or null when not resolvable (bare, alias). */
  resolved: string | null;
}

/** Judge one import of `file` against the layer import rules; one finding per rule clause that hits. */
export function evaluateLayerImport(arch: ArchLaw, file: string, imp: LayerImport): LayerFinding[] {
  const fromLayer = layerForFile(arch, file);
  const targetLayer = imp.resolved ? layerForFile(arch, imp.resolved) : "other";
  const out: LayerFinding[] = [];
  const hit = (ruleId: string): void => {
    out.push({ file, rule_id: ruleId, module_specifier: imp.spec, bindings: imp.bindings, line: imp.line, column: imp.column });
  };
  for (const rule of arch.layerImportRules) {
    if (rule.from_layer !== fromLayer) continue;
    if (rule.forbid_import_layer && targetLayer === rule.forbid_import_layer) hit(rule.id);
    if (rule.forbid_specifier_substring && imp.spec.includes(rule.forbid_specifier_substring)) hit(rule.id);
    if (rule.forbid_resolved_path_substring && imp.resolved?.includes(rule.forbid_resolved_path_substring)) hit(rule.id);
  }
  return out;
}

function compilePatternRegExp(pattern: string): RegExp | null {
  try {
    if (pattern.startsWith("(?i)")) return new RegExp(pattern.slice(4), "im");
    return new RegExp(pattern, "m");
  } catch {
    return null;
  }
}

/** First match of a rule pattern in a file body as 1-based line and column; null when absent or invalid. */
export function findPatternMatch(body: string, pattern: string): { line: number; column: number; match: string } | null {
  const re = compilePatternRegExp(pattern);
  if (!re) return null;
  const m = re.exec(body);
  if (!m || m.index == null) return null;
  const before = body.slice(0, m.index);
  const line = before.split(/\r?\n/).length;
  const lastNl = before.lastIndexOf("\n");
  const column = m.index - (lastNl === -1 ? 0 : lastNl + 1) + 1;
  return { line, column, match: m[0] ?? "" };
}

/**
 * Judge a file body against the pattern rules. A rule applies to the file when one of its `applies_to` globs
 * matches, or, with no `applies_to`, when `appliesByDefault(file)` says so (the caller's scan roots).
 */
export function evaluatePatternRules(arch: ArchLaw, file: string, body: string, appliesByDefault: (repoRel: string) => boolean): LayerFinding[] {
  const norm = normalizeRepoRelativePath(file);
  const out: LayerFinding[] = [];
  for (const rule of arch.patternRules) {
    const applies = rule.applies_to && rule.applies_to.length > 0
      ? rule.applies_to.some((g) => pathMatchesGlobPattern(norm, normalizeRepoRelativePath(g)))
      : appliesByDefault(norm);
    if (!applies) continue;
    if (rule.forbid_pattern) {
      const hit = findPatternMatch(body, rule.forbid_pattern);
      if (hit) out.push({ file: norm, rule_id: rule.id, module_specifier: hit.match, bindings: [], line: hit.line, column: hit.column });
    }
    if (rule.require_pattern) {
      const hit = findPatternMatch(body, rule.require_pattern);
      if (!hit) out.push({ file: norm, rule_id: rule.id, module_specifier: `(missing: ${rule.require_pattern})`, bindings: [], line: 1, column: 1 });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Structural law (ADR-0052 B2, B4): the shape of a codebase, judged over the whole tree. Loaders read files,
// registries and manifests; core counts, compares and matches.

export interface LayerCounts {
  files: number;
  lines: number;
  exports: number;
}

export interface BudgetRule {
  id: string;
  /** Layer whose counts may not exceed the baseline (or the explicit maxima). */
  layer: string;
  max_files?: number;
  max_lines?: number;
  max_exports?: number;
  /** Globs (arch dialect) of files not counted, such as tests. */
  exclude?: string[];
}

export interface OwnerRule {
  id: string;
  /** A regex a file body may match only when the file is one of the owners. */
  pattern: string;
  /** Repo-relative files or arch globs that own the concept. */
  owners: string[];
  applies_to?: string[];
}

export interface RegistryRule {
  id: string;
  /** Regexes with one capture group (or the whole match) naming the registered thing. */
  patterns: string[];
  /** Registry files the loader resolves to `names`; kept for the record. */
  registries: string[];
  /** Every registered name, including the last path segment of a multi-word name. */
  names: string[];
  applies_to?: string[];
}

export interface DependencyRule {
  id: string;
  registry: string;
  manifest: string;
  /** Registered dependency names. */
  allowed: string[];
}

export interface DuplicateRule {
  id: string;
  /** Two directory prefixes; a file under the first that is byte-identical to a file under the second is a duplicate. */
  between: [string, string];
  /** Repo-relative paths (under the first prefix) whose duplicate is accepted for now. */
  allowed?: string[];
}

export interface StructuralLaw {
  /** Per-file sanity ceiling in lines for every counted file; null disables it. */
  fileCeilingLines: number | null;
  budgetRules: BudgetRule[];
  ownerRules: OwnerRule[];
  registryRules: RegistryRule[];
  dependencyRules: DependencyRule[];
  duplicateRules: DuplicateRule[];
}

export function structuralLaw(partial: Partial<StructuralLaw>): StructuralLaw {
  return { fileCeilingLines: null, budgetRules: [], ownerRules: [], registryRules: [], dependencyRules: [], duplicateRules: [], ...partial };
}

export interface CountedFile {
  path: string;
  body: string;
}

/** Structural rules use the general glob (`**`, `*`, `?`); a plain path matches itself. */
function matchesAny(repoRel: string, globs: readonly string[] | undefined): boolean {
  if (!globs || globs.length === 0) return false;
  const norm = normalizeRepoRelativePath(repoRel);
  return globs.some((g) => pathMatchesGlobPattern(norm, normalizeRepoRelativePath(g)));
}

function lineCount(body: string): number {
  return body.split("\n").length - (body.endsWith("\n") ? 1 : 0);
}

/** Files, lines and top-level `export` statements per layer; a file counts in exactly one layer (the first match). */
export function countLayers(arch: ArchLaw, files: readonly CountedFile[], exclude: readonly string[] = []): Record<string, LayerCounts> {
  const counts: Record<string, LayerCounts> = {};
  for (const layer of arch.layers) counts[layer.id] = { files: 0, lines: 0, exports: 0 };
  for (const f of files) {
    if (matchesAny(f.path, exclude)) continue;
    const layer = layerForFile(arch, f.path);
    if (layer === "other") continue;
    const row = counts[layer]!;
    row.files += 1;
    row.lines += lineCount(f.body);
    row.exports += (f.body.match(/^export /gm) ?? []).length;
  }
  return counts;
}

function structuralFinding(file: string, ruleId: string, detail: string, line = 1): LayerFinding {
  return { file, rule_id: ruleId, module_specifier: detail, bindings: [], line, column: 1 };
}

/**
 * Budgets ratchet (B4): a layer's files, lines and exports may not exceed the baseline row (or an explicit
 * maximum); every counted file may not exceed the per-file ceiling (B7). The baseline row of a layer without one
 * is the current count, so a new layer starts at its own size.
 */
export function evaluateBudgets(
  structural: StructuralLaw,
  arch: ArchLaw,
  files: readonly CountedFile[],
  baseline: Readonly<Record<string, LayerCounts>>,
): LayerFinding[] {
  const out: LayerFinding[] = [];
  for (const rule of structural.budgetRules) {
    const counts = countLayers(arch, files, rule.exclude);
    const now = counts[rule.layer] ?? { files: 0, lines: 0, exports: 0 };
    const base = baseline[rule.layer] ?? now;
    const limit = (key: keyof LayerCounts, explicit: number | undefined): number => explicit ?? base[key];
    for (const key of ["files", "lines", "exports"] as const) {
      const max = limit(key, key === "files" ? rule.max_files : key === "lines" ? rule.max_lines : rule.max_exports);
      if (now[key] > max) out.push(structuralFinding(rule.layer, rule.id, `${key} ${now[key]} > ${max}`));
    }
    if (structural.fileCeilingLines !== null) {
      for (const f of files) {
        if (matchesAny(f.path, rule.exclude) || layerForFile(arch, f.path) !== rule.layer) continue;
        const n = lineCount(f.body);
        if (n > structural.fileCeilingLines) out.push(structuralFinding(f.path, rule.id, `file lines ${n} > ceiling ${structural.fileCeilingLines}`));
      }
    }
  }
  return out;
}

function ownerOf(rule: OwnerRule, repoRel: string): boolean {
  return matchesAny(repoRel, rule.owners);
}

/** A concept has one home (B2 `owner`): the pattern may match only in the owner files. */
export function evaluateOwner(structural: StructuralLaw, file: string, body: string, appliesByDefault: (repoRel: string) => boolean): LayerFinding[] {
  const out: LayerFinding[] = [];
  for (const rule of structural.ownerRules) {
    const applies = rule.applies_to && rule.applies_to.length > 0 ? matchesAny(file, rule.applies_to) : appliesByDefault(file);
    if (!applies || ownerOf(rule, file)) continue;
    const hit = findPatternMatch(body, rule.pattern);
    if (hit) out.push({ file: normalizeRepoRelativePath(file), rule_id: rule.id, module_specifier: `${hit.match} (owned by ${rule.owners.join(", ")})`, bindings: [], line: hit.line, column: hit.column });
  }
  return out;
}

/** Every name a pattern captures in the file must be registered (B3); one finding per unregistered name and file. */
export function evaluateRegistry(structural: StructuralLaw, file: string, body: string, appliesByDefault: (repoRel: string) => boolean): LayerFinding[] {
  const out: LayerFinding[] = [];
  for (const rule of structural.registryRules) {
    const applies = rule.applies_to && rule.applies_to.length > 0 ? matchesAny(file, rule.applies_to) : appliesByDefault(file);
    if (!applies) continue;
    const names = new Set(rule.names);
    const seen = new Set<string>();
    for (const pattern of rule.patterns) {
      let re: RegExp;
      try {
        re = new RegExp(pattern, "g");
      } catch {
        continue;
      }
      for (const m of body.matchAll(re)) {
        const name = m[1] ?? m[0];
        if (!name || names.has(name) || seen.has(name)) continue;
        seen.add(name);
        const before = body.slice(0, m.index ?? 0);
        out.push(structuralFinding(normalizeRepoRelativePath(file), rule.id, `${name} is not in ${rule.registries.join(", ")}`, before.split(/\r?\n/).length));
      }
    }
  }
  return out;
}

export interface DeclaredDependency {
  name: string;
  scope: "runtime" | "dev";
}

/** A dependency of the manifest must be registered (B2 `dependency`). */
export function evaluateDependencies(structural: StructuralLaw, deps: readonly DeclaredDependency[]): LayerFinding[] {
  const out: LayerFinding[] = [];
  for (const rule of structural.dependencyRules) {
    const allowed = new Set(rule.allowed);
    for (const d of deps) if (!allowed.has(d.name)) out.push(structuralFinding(rule.manifest, rule.id, `${d.scope} dependency ${d.name} is not in ${rule.registry}`));
  }
  return out;
}

export interface HashedFile {
  path: string;
  sha256: string;
}

/** A file under the first prefix byte-identical to one under the second is a duplicate unless accepted (B2 `duplicate`). */
export function evaluateDuplicates(structural: StructuralLaw, files: readonly HashedFile[]): LayerFinding[] {
  const out: LayerFinding[] = [];
  for (const rule of structural.duplicateRules) {
    const [a, b] = rule.between;
    const allowed = new Set((rule.allowed ?? []).map(normalizeRepoRelativePath));
    const under = (prefix: string): HashedFile[] => files.filter((f) => isPathUnderRoot(f.path, prefix));
    const second = new Map<string, string>();
    for (const f of under(b)) second.set(f.sha256, normalizeRepoRelativePath(f.path));
    for (const f of under(a)) {
      const twin = second.get(f.sha256);
      const path = normalizeRepoRelativePath(f.path);
      if (twin && !allowed.has(path)) out.push(structuralFinding(path, rule.id, `byte-identical to ${twin}`));
    }
  }
  return out;
}
