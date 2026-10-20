import { scopePathLaw } from "../tmvc-path.js";
import fs from "node:fs";
import path from "node:path";
import { toPosixRel, normalizeRepoRelativePath } from "#core/posix-path.js";
import { gitRunOk } from "#git/git.js";
import { GXT_ERROR, type GxtErrorCode } from "#core/error-codes.js";
import { extractImportSites } from "#core/import-scanner.js";
import { evaluateImportSite, law } from "#core/law.js";
import type { ContractImportViolation, ContractViolationKind, EffectiveScope } from "#core/contract-types.js";
import { classifySpecifier, type TsconfigPaths } from "#core/specifier.js";
import { loadTsconfigPaths } from "./resolve-specifier.js";

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

/** The contract's effective scope as a law: the import discipline core judges each site against. */
function lawOfScope(scope: EffectiveScope) {
  return law({
    paths: scopePathLaw(scope.tmvcRoots, scope.forbiddenZones, []),
    allowedImports: scope.allowedImports,
    bannedImports: scope.bannedImports,
    allowDynamicSpecifiers: scope.allowDynamicSpecifiers,
    strictRelativeImports: scope.strictRelativeImports,
  });
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
  const scopeLaw = lawOfScope(scope);
  const out: ContractImportViolation[] = [];
  for (const site of extractImportSites(fs.readFileSync(abs, "utf8"))) {
    const classified = site.spec === null ? null : classifySpecifier(site.spec, norm, ts);
    const v = evaluateImportSite(scopeLaw, norm, site, classified);
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
