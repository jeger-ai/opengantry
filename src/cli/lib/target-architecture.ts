import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { CLI_NAME } from "./constants.js";
import { toPosixRel } from "./cli-io.js";
import { normalizeRepoRelativePath } from "./tmvc-path.js";
import {
  extractBindingsFromSnippet,
  extractImportsWithMeta,
} from "./import-scanner.js";

export const TARGET_ARCHITECTURE_FILENAME = "TARGET_ARCHITECTURE.yaml" as const;
export const TARGET_ARCHITECTURE_SCHEMA_VERSION = "0.2.0" as const;
export const TARGET_ARCHITECTURE_LEGACY_SCHEMA_VERSION = "0.1.0" as const;
export const SUPPORTED_TARGET_ARCHITECTURE_SCHEMA_VERSIONS = [
  TARGET_ARCHITECTURE_LEGACY_SCHEMA_VERSION,
  TARGET_ARCHITECTURE_SCHEMA_VERSION,
] as const;

export type TargetArchitectureSchemaVersion =
  (typeof SUPPORTED_TARGET_ARCHITECTURE_SCHEMA_VERSIONS)[number];

export interface ArchLayerSpec {
  id: string;
  globs: string[];
}

export interface ArchRuleSpec {
  id: string;
  from_layer: string;
  forbid_import_layer?: string;
  forbid_specifier_substring?: string;
  forbid_resolved_path_substring?: string;
}

export interface TargetArchitectureSpec {
  schema_version: TargetArchitectureSchemaVersion;
  /** Explicit scan roots (schema 0.2.0+). When absent, derived from layer globs. */
  scan_roots?: string[];
  /** Supported languages for boundary checks (default: typescript). */
  languages?: string[];
  layers: ArchLayerSpec[];
  rules: ArchRuleSpec[];
}

export interface ArchBoundaryViolation {
  file: string;
  rule_id: string;
  module_specifier: string;
  bindings: string[];
  line: number;
  column: number;
}

export interface ArchCheckResult {
  ok: boolean;
  violations: ArchBoundaryViolation[];
}

function globMatches(repoRel: string, glob: string): boolean {
  const norm = normalizeRepoRelativePath(repoRel);
  const g = normalizeRepoRelativePath(glob);
  if (g.endsWith("/**")) {
    const prefix = g.slice(0, -3);
    return norm === prefix || norm.startsWith(`${prefix}/`);
  }
  if (g.endsWith("**")) {
    const prefix = g.slice(0, -2).replace(/\/$/, "");
    return norm === prefix || norm.startsWith(`${prefix}/`);
  }
  return norm === g;
}

export function layerForFile(spec: TargetArchitectureSpec, repoRel: string): string {
  const norm = normalizeRepoRelativePath(repoRel);
  for (const layer of spec.layers) {
    for (const glob of layer.globs) {
      if (globMatches(norm, glob)) return layer.id;
    }
  }
  return "other";
}

function resolveImportPath(file: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const dir = path.dirname(file);
  let target = path.normalize(path.join(dir, spec));
  const normalized = target.replace(/\\/g, "/");
  if (normalized.endsWith(".js")) {
    target = normalized.slice(0, -3) + ".ts";
  } else if (!normalized.endsWith(".ts")) {
    target = `${normalized}.ts`;
  } else {
    target = normalized;
  }
  return target.replace(/\\/g, "/");
}

function parseSchemaVersion(raw: unknown): TargetArchitectureSchemaVersion {
  if (typeof raw !== "string") {
    throw new Error("TARGET_ARCHITECTURE.yaml: schema_version must be a string");
  }
  if (
    !SUPPORTED_TARGET_ARCHITECTURE_SCHEMA_VERSIONS.includes(
      raw as TargetArchitectureSchemaVersion,
    )
  ) {
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

export function isLegacyTargetArchitectureSchema(version: string): boolean {
  return version === TARGET_ARCHITECTURE_LEGACY_SCHEMA_VERSION;
}

export function targetArchitectureMigrationHint(version: string): string | null {
  if (!isLegacyTargetArchitectureSchema(version)) return null;
  return `TARGET_ARCHITECTURE.yaml schema ${version} is legacy — add scan_roots (schema ${TARGET_ARCHITECTURE_SCHEMA_VERSION}) for explicit adopter roots`;
}

/** Derive scan roots from spec layers or optional manifest TMVC fallback. */
export function resolveArchScanRoots(
  spec: TargetArchitectureSpec,
  manifestTmvcRoots?: readonly string[],
): string[] {
  if (spec.scan_roots && spec.scan_roots.length > 0) {
    return spec.scan_roots.map(normalizeRepoRelativePath);
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

function fileMatchesScanRoots(repoRel: string, scanRoots: readonly string[]): boolean {
  const norm = normalizeRepoRelativePath(repoRel);
  return scanRoots.some((root) => globMatches(norm, root));
}

function fileMatchesLanguage(repoRel: string, languages: readonly string[]): boolean {
  const norm = normalizeRepoRelativePath(repoRel).toLowerCase();
  if (languages.includes("typescript") && norm.endsWith(".ts")) return true;
  return false;
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
  const languages = parseStringArrayField(o.languages, "languages");
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
  const rules: ArchRuleSpec[] = o.rules.map((rule, i) => {
    if (rule == null || typeof rule !== "object") {
      throw new Error(`TARGET_ARCHITECTURE.yaml: rules[${String(i)}] invalid`);
    }
    const r = rule as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id.trim()) {
      throw new Error(`TARGET_ARCHITECTURE.yaml: rules[${String(i)}].id required`);
    }
    if (typeof r.from_layer !== "string") {
      throw new Error(`TARGET_ARCHITECTURE.yaml: rules[${String(i)}].from_layer required`);
    }
    return {
      id: r.id.trim(),
      from_layer: String(r.from_layer),
      ...(r.forbid_import_layer != null ? { forbid_import_layer: String(r.forbid_import_layer) } : {}),
      ...(r.forbid_specifier_substring != null
        ? { forbid_specifier_substring: String(r.forbid_specifier_substring) }
        : {}),
      ...(r.forbid_resolved_path_substring != null
        ? { forbid_resolved_path_substring: String(r.forbid_resolved_path_substring) }
        : {}),
    };
  });
  return {
    schema_version,
    ...(scan_roots ? { scan_roots } : {}),
    ...(languages ? { languages } : {}),
    layers,
    rules,
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

function recordViolation(
  violations: ArchBoundaryViolation[],
  file: string,
  ruleId: string,
  moduleSpecifier: string,
  bindings: string[],
  line: number,
  column: number,
): void {
  violations.push({ file, rule_id: ruleId, module_specifier: moduleSpecifier, bindings, line, column });
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

  for (const file of files) {
    const abs = path.isAbsolute(file) ? path.resolve(file) : path.join(root, file);
    const repoRel = toPosixRel(root, abs);
    if (!fileMatchesScanRoots(repoRel, scanRoots)) continue;
    if (!fileMatchesLanguage(repoRel, languages)) continue;
    if (!fs.existsSync(abs)) continue;
    const fromLayer = layerForFile(spec, repoRel);
    const src = fs.readFileSync(abs, "utf8");
    const imports = extractImportsWithMeta(src, true);

    for (const imp of imports) {
      const bindings = extractBindingsFromSnippet(imp.snippet);
      const resolved = resolveImportPath(repoRel, imp.spec);
      const targetLayer = resolved ? layerForFile(spec, resolved) : "other";

      for (const rule of spec.rules) {
        if (rule.from_layer !== fromLayer) continue;
        if (rule.forbid_import_layer && targetLayer === rule.forbid_import_layer) {
          recordViolation(violations, repoRel, rule.id, imp.spec, bindings, imp.line, imp.column);
        }
        if (rule.forbid_specifier_substring && imp.spec.includes(rule.forbid_specifier_substring)) {
          recordViolation(violations, repoRel, rule.id, imp.spec, bindings, imp.line, imp.column);
        }
        if (
          rule.forbid_resolved_path_substring &&
          resolved?.includes(rule.forbid_resolved_path_substring)
        ) {
          recordViolation(violations, repoRel, rule.id, imp.spec, bindings, imp.line, imp.column);
        }
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

export function runArchCheck(
  repoRoot: string,
  files: readonly string[],
  options: { manifestTmvcRoots?: readonly string[] } = {},
): ArchCheckResult {
  const spec = loadTargetArchitecture(repoRoot);
  const absFiles = files.map((f) =>
    path.isAbsolute(f) ? f : path.join(repoRoot, f.replace(/\\/g, path.sep)),
  );
  return checkArchBoundariesForFiles(spec, repoRoot, absFiles, options);
}

export function formatArchCheckHuman(result: ArchCheckResult): string {
  if (result.ok) return `${CLI_NAME} arch check: OK`;
  const lines = result.violations.map(
    (v) => `${v.file}:${String(v.line)}:${String(v.column)} ${v.rule_id} ${v.module_specifier}`,
  );
  return [`${CLI_NAME} arch check: ${String(result.violations.length)} violation(s)`, ...lines].join(
    "\n",
  );
}
