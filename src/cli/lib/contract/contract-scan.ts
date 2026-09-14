import fs from "node:fs";
import path from "node:path";
import { importMatchesBan } from "../ast-discovery.js";
import { toPosixRel } from "../cli-io.js";
import { gitRunOk } from "../git.js";
import { GXT_ERROR, type GxtErrorCode } from "../gxt-error-codes.js";
import { extractImportSites, type ImportSite } from "../import-scanner.js";
import { isPathUnderRoot, normalizeRepoRelativePath } from "../tmvc-path.js";
import type { ContractImportViolation, ContractViolationKind, EffectiveScope } from "./contract-types.js";
import { classifySpecifier, loadTsconfigPaths, type TsconfigPaths } from "./resolve-specifier.js";

const SOURCE_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage"]);

export function isScannableSource(fileRel: string): boolean {
  const ext = path.extname(fileRel).toLowerCase();
  return SOURCE_EXT.has(ext) && !fileRel.endsWith(".d.ts");
}

function walkSources(repoRoot: string, absRoot: string, out: string[]): void {
  if (!fs.existsSync(absRoot)) return;
  const stat = fs.statSync(absRoot);
  if (stat.isFile()) {
    if (isScannableSource(absRoot)) out.push(toPosixRel(repoRoot, absRoot));
    return;
  }
  if (!stat.isDirectory()) return;
  for (const ent of fs.readdirSync(absRoot, { withFileTypes: true })) {
    const child = path.join(absRoot, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name) || ent.name.startsWith(".")) continue;
      walkSources(repoRoot, child, out);
    } else if (ent.isFile() && isScannableSource(ent.name)) {
      out.push(toPosixRel(repoRoot, child));
    }
  }
}

/** Repo-relative source files under the effective TMVC roots (sorted, deduped). */
export function listSourcesUnderRoots(repoRoot: string, roots: readonly string[]): string[] {
  const out: string[] = [];
  for (const root of roots) walkSources(repoRoot, path.join(repoRoot, root), out);
  return [...new Set(out)].sort();
}

function addGitNames(repoRoot: string, args: string[], out: Set<string>): boolean {
  const r = gitRunOk(repoRoot, [...args, "--"]);
  if (!r.ok) return false;
  for (const line of r.stdout.split(/\r?\n/)) if (line.trim()) out.add(line.trim());
  return true;
}

/**
 * Dirty sources: `git diff --name-only HEAD` ∪ untracked. On an unborn branch (no HEAD) the
 * index (`ls-files --cached`) stands in for the diff. Every argv ends with `--` so a path that
 * looks like a flag is never parsed as one. Missing/deleted paths are dropped.
 */
export function listChangedSourceFiles(repoRoot: string): string[] {
  const out = new Set<string>();
  if (!addGitNames(repoRoot, ["diff", "--name-only", "HEAD"], out)) {
    addGitNames(repoRoot, ["ls-files", "--cached"], out);
  }
  addGitNames(repoRoot, ["ls-files", "--others", "--exclude-standard"], out);
  return [...out]
    .filter((rel) => isScannableSource(rel) && fs.existsSync(path.join(repoRoot, rel)))
    .sort();
}

export function contractViolationCode(kind: ContractViolationKind): GxtErrorCode {
  switch (kind) {
    case "banned":
      return GXT_ERROR.CONTRACT_IMPORT_BANNED;
    case "unlisted":
      return GXT_ERROR.CONTRACT_IMPORT_UNLISTED;
    case "dynamic":
      return GXT_ERROR.CONTRACT_IMPORT_DYNAMIC;
    case "scope_escape":
      return GXT_ERROR.CONTRACT_SCOPE_ESCAPE;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function violation(
  kind: ContractViolationKind,
  file: string,
  site: ImportSite,
  specifier: string,
  detail: string,
): ContractImportViolation {
  return { kind, file, line: site.line, column: site.column, specifier, detail };
}

function checkBareSpecifier(scope: EffectiveScope, file: string, site: ImportSite, spec: string): ContractImportViolation | null {
  const banned = scope.bannedImports.find((b) => importMatchesBan(spec, b));
  if (banned) {
    return violation("banned", file, site, spec, `import of banned specifier "${spec}" (banned: ${banned})`);
  }
  if (scope.allowedImports.length > 0 && !scope.allowedImports.some((a) => importMatchesBan(spec, a))) {
    return violation("unlisted", file, site, spec, `import "${spec}" is not in contract.allowed_imports`);
  }
  return null;
}

function checkResolvedPath(
  scope: EffectiveScope,
  file: string,
  site: ImportSite,
  spec: string,
  resolvedRepoRel: string,
): ContractImportViolation | null {
  const forbidden = scope.forbiddenZones.find((fz) => isPathUnderRoot(resolvedRepoRel, fz));
  if (forbidden) {
    return violation("scope_escape", file, site, spec, `import resolves into forbidden zone ${forbidden} (${resolvedRepoRel})`);
  }
  if (scope.strictRelativeImports && scope.tmvcRoots.length > 0) {
    const inside = scope.tmvcRoots.some((r) => isPathUnderRoot(resolvedRepoRel, r));
    if (!inside) {
      return violation("scope_escape", file, site, spec, `import resolves outside effective TMVC roots (${resolvedRepoRel})`);
    }
  }
  return null;
}

function checkSite(scope: EffectiveScope, file: string, site: ImportSite, ts: TsconfigPaths | null): ContractImportViolation | null {
  if (site.spec === null) {
    if (scope.allowDynamicSpecifiers) return null;
    return violation("dynamic", file, site, site.expression ?? "", `non-literal ${site.kind === "require_expr" ? "require" : "import"}(${site.expression ?? ""}) is not allowed (contract.allow_dynamic_specifiers=false)`);
  }
  const cls = classifySpecifier(site.spec, file, ts);
  switch (cls.kind) {
    case "builtin":
      return null;
    case "bare":
      return checkBareSpecifier(scope, file, site, cls.specifier);
    case "relative":
    case "alias":
      return checkResolvedPath(scope, file, site, cls.specifier, cls.resolvedRepoRel);
    default: {
      const _exhaustive: never = cls;
      return _exhaustive;
    }
  }
}

/** Scan a single source file's import sites against the effective scope. */
export function scanFileImports(
  repoRoot: string,
  fileRel: string,
  scope: EffectiveScope,
  ts: TsconfigPaths | null = loadTsconfigPaths(repoRoot),
): ContractImportViolation[] {
  const abs = path.join(repoRoot, fileRel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return [];
  const norm = normalizeRepoRelativePath(fileRel);
  const out: ContractImportViolation[] = [];
  for (const site of extractImportSites(fs.readFileSync(abs, "utf8"))) {
    const v = checkSite(scope, norm, site, ts);
    if (v) out.push(v);
  }
  return out;
}

export interface ScanContractImportsOptions {
  /** Explicit repo-relative files; defaults to every source file under the effective TMVC roots. */
  files?: readonly string[];
}

/**
 * Import-site scan for the effective cage: banned / unlisted bare specifiers, non-literal dynamic
 * specifiers, and relative or alias imports resolving into forbidden zones (or outside TMVC when
 * `strict_relative_imports`). Deterministic ordering by file, line, column.
 */
export function scanContractImports(
  repoRoot: string,
  scope: EffectiveScope,
  options: ScanContractImportsOptions = {},
): ContractImportViolation[] {
  const files = options.files
    ? [...new Set(options.files.map(normalizeRepoRelativePath))].filter(isScannableSource).sort()
    : scope.tmvcRoots.length > 0
      ? listSourcesUnderRoots(repoRoot, scope.tmvcRoots)
      : listChangedSourceFiles(repoRoot);
  const ts = loadTsconfigPaths(repoRoot);
  const out: ContractImportViolation[] = [];
  for (const file of files) out.push(...scanFileImports(repoRoot, file, scope, ts));
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
}

export function formatContractViolation(v: ContractImportViolation): string {
  return `[${contractViolationCode(v.kind)}] ${v.file}:${v.line}:${v.column} ${v.detail}`;
}
