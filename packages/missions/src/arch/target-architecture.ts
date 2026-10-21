import fs from "node:fs";
import path from "node:path";
import { pathMatchesGlobPattern } from "#core/path-glob.js";
import { archLaw, countLayers, evaluateBudgets, evaluateCycles, evaluateDependencies, evaluateDuplicates, evaluateLayerImport, evaluateOwner, evaluatePatternRules, evaluateRegistry, layerForFile as coreLayerForFile, structuralLaw, type ArchLaw, type CountedFile, type DeclaredDependency, type HashedFile, type ImportEdge, type LayerCounts, type RegisteredDependency, type StructuralLaw } from "#core/law.js";
import { normalizeRepoRelativePath, toPosixRel } from "#core/posix-path.js";
import { classifySpecifier, type TsconfigPaths } from "#core/specifier.js";
import { loadImportAliases } from "../contract/resolve-specifier.js";
import crypto from "node:crypto";
import { gitRunOk } from "#git/git.js";
import { getDomainAdapter } from "../domains/index.js";
import YAML from "yaml";
import { CLI_NAME, TARGET_ARCHITECTURE_FILENAME } from "#core/constants.js";
import {
  extractBindingsFromSnippet,
  extractImportSites,
  extractImportsWithMeta,
} from "#core/import-scanner.js";
import { walkDomainFiles } from "../discovery-scanner.js";

const TARGET_ARCHITECTURE_LEGACY_SCHEMA_VERSION = "0.1.0" as const;
export const TARGET_ARCHITECTURE_SCHEMA_VERSION = "0.2.0" as const;
export const TARGET_ARCHITECTURE_V3_SCHEMA_VERSION = "0.3.0" as const;
/** Structural rule kinds (ADR-0052 B2): budget, owner, registry, dependency, duplicate, cycles; `file_ceiling_lines`; `exclude`. */
const TARGET_ARCHITECTURE_V4_SCHEMA_VERSION = "0.4.0" as const;
const SUPPORTED_TARGET_ARCHITECTURE_SCHEMA_VERSIONS = [
  TARGET_ARCHITECTURE_LEGACY_SCHEMA_VERSION,
  TARGET_ARCHITECTURE_SCHEMA_VERSION,
  TARGET_ARCHITECTURE_V3_SCHEMA_VERSION,
  TARGET_ARCHITECTURE_V4_SCHEMA_VERSION,
] as const;

type TargetArchitectureSchemaVersion =
  (typeof SUPPORTED_TARGET_ARCHITECTURE_SCHEMA_VERSIONS)[number];

interface ArchLayerSpec {
  id: string;
  globs: string[];
}

interface ArchRuleBase {
  id: string;
  from_layer: string;
  applies_to?: string[];
}

interface ArchImportRule extends ArchRuleBase {
  kind: "import";
  forbid_import_layer?: string;
  forbid_specifier_substring?: string;
  forbid_resolved_path_substring?: string;
}

interface ArchPatternRule extends ArchRuleBase {
  kind: "pattern";
  forbid_pattern?: string;
  require_pattern?: string;
}

interface ArchBudgetRule extends ArchRuleBase {
  kind: "budget";
  layer: string;
  max_files?: number;
  max_lines?: number;
  max_exports?: number;
  exclude?: string[];
}
interface ArchOwnerRule extends ArchRuleBase {
  kind: "owner";
  pattern: string;
  owners: string[];
}
interface ArchRegistryRule extends ArchRuleBase {
  kind: "registry";
  patterns: string[];
  registries: string[];
}
interface ArchDependencyRule extends ArchRuleBase {
  kind: "dependency";
  registry: string;
  manifest: string;
}
interface ArchDuplicateRule extends ArchRuleBase {
  kind: "duplicate";
  between: [string, string];
  allowed?: string[];
}
interface ArchCycleRule extends ArchRuleBase {
  kind: "cycles";
}
type ArchStructuralRule = ArchBudgetRule | ArchOwnerRule | ArchRegistryRule | ArchDependencyRule | ArchDuplicateRule | ArchCycleRule;
const ARCH_STRUCTURAL_KINDS = ["budget", "owner", "registry", "dependency", "duplicate", "cycles"] as const;
export type ArchRuleSpec = ArchImportRule | ArchPatternRule | ArchStructuralRule;

export interface TargetArchitectureSpec {
  schema_version: TargetArchitectureSchemaVersion;
  domain?: string;
  scan_roots?: string[];
  /** Globs of files under the scan roots that no rule judges and no budget counts, such as tests. */
  exclude?: string[];
  languages?: string[];
  layers: ArchLayerSpec[];
  rules: ArchRuleSpec[];
  /** Per-file sanity ceiling in lines for budget-counted files (ADR-0052 B7); absent means none. */
  file_ceiling_lines?: number;
}

interface ArchBoundaryViolation {
  file: string;
  rule_id: string;
  module_specifier: string;
  bindings: string[];
  line: number;
  column: number;
}

interface ArchCheckResult {
  ok: boolean;
  violations: ArchBoundaryViolation[];
}

/** The spec's layers and rules as the core architecture law. */
function archLawOfSpec(spec: TargetArchitectureSpec): ArchLaw {
  return archLaw({
    layers: spec.layers,
    layerImportRules: spec.rules.filter((r): r is ArchImportRule => r.kind === "import"),
    patternRules: spec.rules.filter((r): r is ArchPatternRule => r.kind === "pattern"),
  });
}

export function layerForFile(spec: TargetArchitectureSpec, repoRel: string): string {
  return coreLayerForFile(archLawOfSpec(spec), repoRel);
}

/** The source file an import names, for layer membership: relative and alias specifiers resolve, `.js` reads as `.ts`. */
function resolveImportTarget(file: string, spec: string, aliases: TsconfigPaths | null): string | null {
  const classified = classifySpecifier(spec, file, aliases);
  if (classified.kind !== "relative" && classified.kind !== "alias") return null;
  const target = classified.resolvedRepoRel;
  if (target.endsWith(".js")) return `${target.slice(0, -3)}.ts`;
  return target.endsWith(".ts") ? target : `${target}.ts`;
}

function parseOptionalCount(raw: unknown, where: string): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) throw new Error(`TARGET_ARCHITECTURE.yaml: ${where} must be a non-negative integer`);
  return raw;
}

function requireString(r: Record<string, unknown>, key: string, where: string): string {
  const v = r[key];
  if (typeof v !== "string" || !v.trim()) throw new Error(`TARGET_ARCHITECTURE.yaml: ${where}.${key} required`);
  return v.trim();
}

/** Structural rules (schema 0.4.0): an explicit `kind` selects the fields; unknown keys are not checked here. */
function parseStructuralRule(r: Record<string, unknown>, index: number, id: string): ArchStructuralRule {
  const where = `rules[${String(index)}] "${id}"`;
  const appliesTo = parseStringArrayField(r.applies_to, "applies_to");
  const base = { id, from_layer: typeof r.from_layer === "string" ? r.from_layer : "*", ...(appliesTo ? { applies_to: appliesTo } : {}) };
  switch (r.kind) {
    case "budget": {
      const exclude = parseStringArrayField(r.exclude, "exclude");
      return {
        ...base,
        kind: "budget",
        layer: requireString(r, "layer", where),
        max_files: parseOptionalCount(r.max_files, `${where}.max_files`),
        max_lines: parseOptionalCount(r.max_lines, `${where}.max_lines`),
        max_exports: parseOptionalCount(r.max_exports, `${where}.max_exports`),
        ...(exclude ? { exclude } : {}),
      };
    }
    case "owner":
      return { ...base, kind: "owner", pattern: requireString(r, "pattern", where), owners: parseStringArrayField(r.owners, "owners", { required: true })! };
    case "registry": {
      const patterns = parseStringArrayField(r.patterns, "patterns");
      const registries = parseStringArrayField(r.registries, "registries");
      if (!patterns?.length) throw new Error(`TARGET_ARCHITECTURE.yaml: ${where}.patterns required`);
      if (!registries?.length) throw new Error(`TARGET_ARCHITECTURE.yaml: ${where}.registries required`);
      return { ...base, kind: "registry", patterns, registries };
    }
    case "dependency":
      return { ...base, kind: "dependency", registry: requireString(r, "registry", where), manifest: typeof r.manifest === "string" ? r.manifest : "package.json" };
    case "duplicate": {
      const between = parseStringArrayField(r.between, "between", { required: true })!;
      if (between.length !== 2) throw new Error(`TARGET_ARCHITECTURE.yaml: ${where}.between must name two directory prefixes`);
      const allowed = parseStringArrayField(r.allowed, "allowed");
      return { ...base, kind: "duplicate", between: [between[0]!, between[1]!], ...(allowed ? { allowed } : {}) };
    }
    case "cycles":
      return { ...base, kind: "cycles" };
    default:
      throw new Error(`TARGET_ARCHITECTURE.yaml: ${where} has unknown kind ${String(r.kind)}`);
  }
}

function parseSchemaVersion(raw: unknown): TargetArchitectureSchemaVersion {
  if (typeof raw !== "string") {
    throw new Error("TARGET_ARCHITECTURE.yaml: schema_version must be a string");
  }
  if (!SUPPORTED_TARGET_ARCHITECTURE_SCHEMA_VERSIONS.includes(raw as TargetArchitectureSchemaVersion)) {
    throw new Error(
      `TARGET_ARCHITECTURE.yaml: unsupported schema_version (supported: ${SUPPORTED_TARGET_ARCHITECTURE_SCHEMA_VERSIONS.join(", ")})`,
    );
  }
  return raw as TargetArchitectureSchemaVersion;
}

function parseStringArrayField(
  raw: unknown,
  field: string,
  opts: { required?: boolean } = {},
): string[] | undefined {
  if (raw === undefined) {
    if (opts.required) throw new Error(`TARGET_ARCHITECTURE.yaml: ${field} required`);
    return undefined;
  }
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) {
    throw new Error(`TARGET_ARCHITECTURE.yaml: ${field} must be a string array`);
  }
  return raw.map(String);
}

function isLegacyTargetArchitectureSchema(version: string): boolean {
  return version === TARGET_ARCHITECTURE_LEGACY_SCHEMA_VERSION;
}

export function targetArchitectureMigrationHint(version: string): string | null {
  if (!isLegacyTargetArchitectureSchema(version)) return null;
  return `TARGET_ARCHITECTURE.yaml schema ${version} is legacy — add scan_roots (schema ${TARGET_ARCHITECTURE_SCHEMA_VERSION}) for explicit adopter roots`;
}

export function resolveArchScanRoots(
  spec: TargetArchitectureSpec,
  manifestTmvcRoots?: readonly string[],
): string[] {
  if (spec.scan_roots && spec.scan_roots.length > 0) {
    return spec.scan_roots.map((root) => {
      const norm = normalizeRepoRelativePath(root);
      if (norm.includes("*")) return norm;
      return `${norm.replace(/\/$/, "")}/**`;
    });
  }
  const fromLayers = spec.layers.flatMap((layer) => layer.globs.map(normalizeRepoRelativePath));
  if (fromLayers.length > 0) return fromLayers;
  if (manifestTmvcRoots && manifestTmvcRoots.length > 0) {
    return manifestTmvcRoots.map((root) => {
      const norm = normalizeRepoRelativePath(root);
      return norm.endsWith("/**") ? norm : `${norm.replace(/\/$/, "")}/**`;
    });
  }
  return [];
}

function resolveArchLanguages(spec: TargetArchitectureSpec): string[] {
  if (spec.languages && spec.languages.length > 0) return spec.languages;
  return ["typescript"];
}

export function fileMatchesScanRoots(repoRel: string, scanRoots: readonly string[], exclude: readonly string[] = []): boolean {
  const norm = normalizeRepoRelativePath(repoRel);
  return scanRoots.some((root) => pathMatchesGlobPattern(norm, root)) && !exclude.some((glob) => pathMatchesGlobPattern(norm, normalizeRepoRelativePath(glob)));
}


function adapterSupportsImportRules(spec: TargetArchitectureSpec): boolean {
  const domain = spec.domain?.trim().toLowerCase();
  if (!domain) return getDomainAdapter("code").supportsImportRules;
  try {
    return getDomainAdapter(domain).supportsImportRules;
  } catch {
    return getDomainAdapter("code").supportsImportRules;
  }
}




function fileMatchesLanguage(repoRel: string, languages: readonly string[], domain?: string): boolean {
  const norm = normalizeRepoRelativePath(repoRel).toLowerCase();
  if (domain === "content") {
    return /\.(md|html|htm|txt|json)$/i.test(norm);
  }
  if (languages.includes("typescript") && /\.tsx?$/i.test(norm)) return true;
  return false;
}

function presentString(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  return String(raw);
}

function parseArchRule(rule: unknown, index: number): ArchRuleSpec {
  if (rule == null || typeof rule !== "object") {
    throw new Error(`TARGET_ARCHITECTURE.yaml: rules[${String(index)}] invalid`);
  }
  const r = rule as Record<string, unknown>;
  const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : "(missing id)";
  if (typeof r.id !== "string" || !r.id.trim()) {
    throw new Error(`TARGET_ARCHITECTURE.yaml: rules[${String(index)}].id required`);
  }
  if (typeof r.kind === "string" && (ARCH_STRUCTURAL_KINDS as readonly string[]).includes(r.kind)) {
    return parseStructuralRule(r, index, id);
  }
  return parseImportOrPatternRule(r, index, id);
}

/** Import and pattern rules (schemas 0.1.0 to 0.3.0 and unchanged in 0.4.0): the kind is inferred from the fields. */
function parseImportOrPatternRule(r: Record<string, unknown>, index: number, id: string): ArchImportRule | ArchPatternRule {
  if (typeof r.from_layer !== "string") {
    throw new Error(`TARGET_ARCHITECTURE.yaml: rules[${String(index)}].from_layer required`);
  }
  const appliesTo = parseStringArrayField(r.applies_to, "applies_to");
  const forbidImportLayer = presentString(r.forbid_import_layer);
  const forbidSpecifier = presentString(r.forbid_specifier_substring);
  const forbidResolved = presentString(r.forbid_resolved_path_substring);
  const forbidPattern = presentString(r.forbid_pattern);
  const requirePattern = presentString(r.require_pattern);
  const importRule = [forbidImportLayer, forbidSpecifier, forbidResolved].some((value) => value != null);
  const patternRule = [forbidPattern, requirePattern].some((value) => value != null);
  if (importRule && patternRule) {
    throw new Error(
      `TARGET_ARCHITECTURE.yaml: rules[${String(index)}] "${id}" sets both import fields and pattern fields. Split this mixed rule into two distinct YAML entries, one import rule and one pattern rule.`,
    );
  }
  if (!importRule && !patternRule) {
    throw new Error(
      `TARGET_ARCHITECTURE.yaml: rules[${String(index)}] "${id}" sets neither import fields (forbid_import_layer, forbid_specifier_substring, forbid_resolved_path_substring) nor pattern fields (forbid_pattern, require_pattern).`,
    );
  }
  const base = {
    id,
    from_layer: String(r.from_layer),
    ...(appliesTo ? { applies_to: appliesTo } : {}),
  };
  if (importRule) {
    return {
      ...base,
      kind: "import",
      ...(forbidImportLayer != null ? { forbid_import_layer: forbidImportLayer } : {}),
      ...(forbidSpecifier != null ? { forbid_specifier_substring: forbidSpecifier } : {}),
      ...(forbidResolved != null ? { forbid_resolved_path_substring: forbidResolved } : {}),
    };
  }
  return {
    ...base,
    kind: "pattern",
    ...(forbidPattern != null ? { forbid_pattern: forbidPattern } : {}),
    ...(requirePattern != null ? { require_pattern: requirePattern } : {}),
  };
}

export function validateTargetArchitecture(raw: unknown): TargetArchitectureSpec {
  if (raw == null || typeof raw !== "object") {
    throw new Error("TARGET_ARCHITECTURE.yaml must be a mapping");
  }
  const o = raw as Record<string, unknown>;
  const schema_version = parseSchemaVersion(o.schema_version);
  if (!Array.isArray(o.layers) || o.layers.length === 0) {
    throw new Error("TARGET_ARCHITECTURE.yaml: layers must be a non-empty array");
  }
  if (!Array.isArray(o.rules)) {
    throw new Error("TARGET_ARCHITECTURE.yaml: rules must be an array");
  }
  const scan_roots = parseStringArrayField(o.scan_roots, "scan_roots");
  const exclude = parseStringArrayField(o.exclude, "exclude");
  const languages = parseStringArrayField(o.languages, "languages");
  const domain = typeof o.domain === "string" ? o.domain.trim() : undefined;
  const layers: ArchLayerSpec[] = o.layers.map((layer, i) => {
    if (layer == null || typeof layer !== "object") {
      throw new Error(`TARGET_ARCHITECTURE.yaml: layers[${String(i)}] invalid`);
    }
    const l = layer as Record<string, unknown>;
    if (typeof l.id !== "string" || !l.id.trim()) {
      throw new Error(`TARGET_ARCHITECTURE.yaml: layers[${String(i)}].id required`);
    }
    if (!Array.isArray(l.globs) || l.globs.some((g) => typeof g !== "string")) {
      throw new Error(`TARGET_ARCHITECTURE.yaml: layers[${String(i)}].globs invalid`);
    }
    return { id: l.id.trim(), globs: l.globs.map(String) };
  });
  const rules: ArchRuleSpec[] = o.rules.map((rule, i) => parseArchRule(rule, i));
  const file_ceiling_lines = parseOptionalCount(o.file_ceiling_lines, "file_ceiling_lines");
  return {
    schema_version,
    ...(domain ? { domain } : {}),
    ...(scan_roots ? { scan_roots } : {}),
    ...(exclude ? { exclude } : {}),
    ...(languages ? { languages } : {}),
    layers,
    rules,
    ...(file_ceiling_lines !== undefined ? { file_ceiling_lines } : {}),
  };
}

export function loadTargetArchitecture(repoRoot: string): TargetArchitectureSpec {
  const abs = path.join(repoRoot, TARGET_ARCHITECTURE_FILENAME);
  if (!fs.existsSync(abs)) {
    throw new Error(`${TARGET_ARCHITECTURE_FILENAME} missing at repository root`);
  }
  const parsed = YAML.parse(fs.readFileSync(abs, "utf8")) as unknown;
  return validateTargetArchitecture(parsed);
}


export function checkArchBoundariesForFiles(
  spec: TargetArchitectureSpec,
  repoRoot: string,
  files: readonly string[],
  options: { manifestTmvcRoots?: readonly string[] } = {},
): ArchCheckResult {
  const violations: ArchBoundaryViolation[] = [];
  const root = path.resolve(repoRoot);
  const scanRoots = resolveArchScanRoots(spec, options.manifestTmvcRoots);
  const languages = resolveArchLanguages(spec);
  const evaluateImports = adapterSupportsImportRules(spec);
  const arch = archLawOfSpec(spec);
  const structural = structuralLawOfSpec(spec, root);
  const inScan = (rel: string): boolean => fileMatchesScanRoots(rel, scanRoots, spec.exclude);
  const aliases = evaluateImports ? loadImportAliases(root) : null;

  for (const file of files) {
    const abs = path.isAbsolute(file) ? path.resolve(file) : path.join(root, file);
    const repoRel = toPosixRel(root, abs);
    if (!inScan(repoRel)) continue;
    if (!fileMatchesLanguage(repoRel, languages, spec.domain)) continue;
    if (!fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, "utf8");

    violations.push(...evaluatePatternRules(arch, repoRel, src, inScan));
    violations.push(...evaluateOwner(structural, repoRel, src, inScan));
    violations.push(...evaluateRegistry(structural, repoRel, src, inScan));

    if (!evaluateImports) continue;

    for (const imp of extractImportsWithMeta(src, true)) {
      violations.push(
        ...evaluateLayerImport(arch, repoRel, {
          spec: imp.spec,
          line: imp.line,
          column: imp.column,
          bindings: extractBindingsFromSnippet(imp.snippet),
          resolved: resolveImportTarget(repoRel, imp.spec, aliases),
        }),
      );
    }
  }

  return { ok: violations.length === 0, violations };
}

const ARCH_BASELINE_FILENAME = "ARCH_BASELINE.json" as const;
const ARCH_BASELINE_SCHEMA = "opengantry.arch-baseline.v1" as const;

interface ArchBaseline {
  schema: typeof ARCH_BASELINE_SCHEMA;
  commit: string;
  file_ceiling_lines: number | null;
  layers: Record<string, LayerCounts>;
}

function registryEntries(repoRoot: string, registryRel: string): Record<string, unknown>[] {
  const abs = path.join(repoRoot, registryRel);
  if (!fs.existsSync(abs)) throw new Error(`TARGET_ARCHITECTURE.yaml: registry ${registryRel} not found`);
  const doc = YAML.parse(fs.readFileSync(abs, "utf8")) as { entries?: Record<string, unknown>[] };
  return (doc.entries ?? []).filter((e) => typeof e.name === "string");
}

/** Registered names of a registry file: every entry name plus the last segment of a multi-word name. */
function registryNames(repoRoot: string, registryRel: string): string[] {
  const names: string[] = [];
  for (const e of registryEntries(repoRoot, registryRel)) {
    const name = e.name as string;
    names.push(name);
    const last = name.split(" ").pop();
    if (last && last !== name) names.push(last);
  }
  return names;
}

/** The dependency registry's entries with the scope and range they record. */
function registeredDependencies(repoRoot: string, registryRel: string): RegisteredDependency[] {
  return registryEntries(repoRoot, registryRel).map((e) => ({
    name: e.name as string,
    ...(e.scope === "runtime" || e.scope === "dev" ? { scope: e.scope } : {}),
    ...(typeof e.range === "string" ? { range: e.range } : {}),
  }));
}

/** The spec's structural rules as the core structural law, with registries resolved to names. */
function structuralLawOfSpec(spec: TargetArchitectureSpec, repoRoot: string): StructuralLaw {
  const law = structuralLaw({ fileCeilingLines: spec.file_ceiling_lines ?? null });
  for (const rule of spec.rules) {
    switch (rule.kind) {
      case "budget":
        law.budgetRules.push({ id: rule.id, layer: rule.layer, max_files: rule.max_files, max_lines: rule.max_lines, max_exports: rule.max_exports, exclude: rule.exclude });
        break;
      case "owner":
        law.ownerRules.push({ id: rule.id, pattern: rule.pattern, owners: rule.owners, applies_to: rule.applies_to });
        break;
      case "registry":
        law.registryRules.push({ id: rule.id, patterns: rule.patterns, registries: rule.registries, names: rule.registries.flatMap((r) => registryNames(repoRoot, r)), applies_to: rule.applies_to });
        break;
      case "dependency":
        law.dependencyRules.push({ id: rule.id, registry: rule.registry, manifest: rule.manifest, registered: registeredDependencies(repoRoot, rule.registry) });
        break;
      case "duplicate":
        law.duplicateRules.push({ id: rule.id, between: rule.between, allowed: rule.allowed });
        break;
      case "cycles":
        law.cycleRules.push({ id: rule.id });
        break;
      default:
        break;
    }
  }
  return law;
}

function countedFiles(repoRoot: string, spec: TargetArchitectureSpec, files: readonly string[]): CountedFile[] {
  const scanRoots = resolveArchScanRoots(spec);
  const languages = resolveArchLanguages(spec);
  const out: CountedFile[] = [];
  for (const file of files) {
    const abs = path.isAbsolute(file) ? path.resolve(file) : path.join(repoRoot, file);
    const rel = toPosixRel(repoRoot, abs);
    if (!fileMatchesScanRoots(rel, scanRoots, spec.exclude) || !fileMatchesLanguage(rel, languages, spec.domain) || !fs.existsSync(abs)) continue;
    out.push({ path: rel, body: fs.readFileSync(abs, "utf8") });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function readArchBaseline(repoRoot: string): ArchBaseline | null {
  const abs = path.join(repoRoot, ARCH_BASELINE_FILENAME);
  if (!fs.existsSync(abs)) return null;
  const parsed = JSON.parse(fs.readFileSync(abs, "utf8")) as Partial<ArchBaseline>;
  if (parsed.schema !== ARCH_BASELINE_SCHEMA || typeof parsed.layers !== "object" || parsed.layers === null) {
    throw new Error(`${ARCH_BASELINE_FILENAME}: expected schema ${ARCH_BASELINE_SCHEMA} with a layers map`);
  }
  return parsed as ArchBaseline;
}

function hashedFilesUnder(repoRoot: string, prefixes: readonly string[]): HashedFile[] {
  const out: HashedFile[] = [];
  const walk = (abs: string): void => {
    if (!fs.existsSync(abs)) return;
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = path.join(abs, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === ".git") continue;
        walk(child);
      } else if (ent.isFile()) {
        out.push({ path: toPosixRel(repoRoot, child), sha256: crypto.createHash("sha256").update(fs.readFileSync(child)).digest("hex") });
      }
    }
  };
  for (const prefix of prefixes) walk(path.join(repoRoot, prefix));
  return out;
}

function declaredDependencies(repoRoot: string, manifestRel: string): DeclaredDependency[] {
  const abs = path.join(repoRoot, manifestRel);
  if (!fs.existsSync(abs)) return [];
  const pkg = JSON.parse(fs.readFileSync(abs, "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  return [
    ...Object.entries(pkg.dependencies ?? {}).map(([name, range]) => ({ name, scope: "runtime" as const, range })),
    ...Object.entries(pkg.devDependencies ?? {}).map(([name, range]) => ({ name, scope: "dev" as const, range })),
  ];
}

/** Runtime import edges among the counted files: static imports and re-exports, alias-aware; `import type` is not an edge. */
function runtimeImportEdges(repoRoot: string, counted: readonly CountedFile[]): ImportEdge[] {
  const aliases = loadImportAliases(repoRoot);
  const paths = new Set(counted.map((f) => f.path));
  const edges: ImportEdge[] = [];
  for (const f of counted) {
    for (const site of extractImportSites(f.body)) {
      if ((site.kind !== "static" && site.kind !== "export_from") || !site.spec || /^(?:import|export)\s+type\b/.test(site.snippet)) continue;
      const to = resolveImportTarget(f.path, site.spec, aliases);
      if (to && paths.has(to)) edges.push({ from: f.path, to });
    }
  }
  return edges;
}

/**
 * Whole-tree structural checks (ADR-0052 B2): budgets against ARCH_BASELINE.json, runtime import cycles, declared
 * dependencies against their registry, and byte-identical files between two trees. Runs when `gantry arch check`
 * walks the scan roots itself; a partial file list cannot be judged for shape.
 */
export function checkArchStructure(spec: TargetArchitectureSpec, repoRoot: string, files: readonly string[]): ArchCheckResult {
  const structural = structuralLawOfSpec(spec, repoRoot);
  const arch = archLawOfSpec(spec);
  const violations: ArchBoundaryViolation[] = [];
  const counted = structural.budgetRules.length > 0 || structural.cycleRules.length > 0 ? countedFiles(repoRoot, spec, files) : [];
  if (structural.budgetRules.length > 0) {
    const baseline = readArchBaseline(repoRoot);
    violations.push(...evaluateBudgets(structural, arch, counted, baseline?.layers ?? {}));
  }
  if (structural.cycleRules.length > 0) violations.push(...evaluateCycles(structural, runtimeImportEdges(repoRoot, counted)));
  for (const rule of structural.dependencyRules) {
    violations.push(...evaluateDependencies({ ...structural, dependencyRules: [rule] }, declaredDependencies(repoRoot, rule.manifest)));
  }
  for (const rule of structural.duplicateRules) {
    violations.push(...evaluateDuplicates({ ...structural, duplicateRules: [rule] }, hashedFilesUnder(repoRoot, rule.between)));
  }
  return { ok: violations.length === 0, violations };
}

export interface RatchetResult {
  written: boolean;
  path: string;
  /** Layers whose counts rose above the previous baseline. Empty when the ratchet only lowered or kept counts. */
  raised: string[];
  layers: Record<string, LayerCounts>;
}

/**
 * Record the current per-layer counts as ARCH_BASELINE.json (ADR-0052 B4). Lower-only: a layer that grew is
 * refused unless `allowRaise`, which only a Planner mission passes. Counts use each layer's budget-rule excludes.
 */
export function ratchetArchBaseline(spec: TargetArchitectureSpec, repoRoot: string, files: readonly string[], allowRaise: boolean): RatchetResult {
  const structural = structuralLawOfSpec(spec, repoRoot);
  const arch = archLawOfSpec(spec);
  const counted = countedFiles(repoRoot, spec, files);
  const layers: Record<string, LayerCounts> = {};
  for (const layer of spec.layers) {
    const rule = structural.budgetRules.find((r) => r.layer === layer.id);
    layers[layer.id] = countLayers(arch, counted, rule?.exclude ?? [])[layer.id] ?? { files: 0, lines: 0, exports: 0 };
  }
  const previous = readArchBaseline(repoRoot);
  const raised: string[] = [];
  for (const [id, now] of Object.entries(layers)) {
    const was = previous?.layers[id];
    if (was && (now.files > was.files || now.lines > was.lines || now.exports > was.exports)) raised.push(id);
  }
  const target = path.join(repoRoot, ARCH_BASELINE_FILENAME);
  if (raised.length > 0 && !allowRaise) return { written: false, path: target, raised, layers };
  const head = gitRunOk(repoRoot, ["rev-parse", "HEAD"]);
  const baseline: ArchBaseline = {
    schema: ARCH_BASELINE_SCHEMA,
    commit: head.ok ? head.stdout.trim() : "",
    file_ceiling_lines: spec.file_ceiling_lines ?? null,
    layers,
  };
  fs.writeFileSync(target, `${JSON.stringify(baseline, null, 2)}\n`);
  return { written: true, path: target, raised, layers };
}

export function runArchCheck(
  repoRoot: string,
  files: readonly string[],
  options: { manifestTmvcRoots?: readonly string[]; wholeTree?: boolean } = {},
): ArchCheckResult {
  const spec = loadTargetArchitecture(repoRoot);
  const absFiles = files.map((f) =>
    path.isAbsolute(f) ? f : path.join(repoRoot, f.replace(/\\/g, path.sep)),
  );
  const boundaries = checkArchBoundariesForFiles(spec, repoRoot, absFiles, options);
  if (!options.wholeTree) return boundaries;
  const structure = checkArchStructure(spec, repoRoot, absFiles);
  const violations = [...boundaries.violations, ...structure.violations];
  return { ok: violations.length === 0, violations };
}

export function formatArchCheckHuman(result: ArchCheckResult, label: "arch" | "perimeter" = "arch"): string {
  if (result.ok) return `${CLI_NAME} ${label} check: OK`;
  const lines = result.violations.map(
    (v) => `${v.file}:${String(v.line)}:${String(v.column)} ${v.rule_id} ${v.module_specifier}`,
  );
  return [`${CLI_NAME} ${label} check: ${String(result.violations.length)} violation(s)`, ...lines].join("\n");
}

export function walkPerimeterFiles(repoRoot: string, spec: TargetArchitectureSpec): string[] {
  const domain = spec.domain?.toLowerCase() ?? "code";
  const adapter = getDomainAdapter(domain);
  const scanRoots = resolveArchScanRoots(spec);
  const all = walkDomainFiles(repoRoot, adapter.fileExtensions);
  return all.filter((abs) => {
    const rel = toPosixRel(repoRoot, abs);
    return fileMatchesScanRoots(rel, scanRoots, spec.exclude);
  });
}
