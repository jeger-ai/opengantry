import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { normalizeRepoRelativePath } from "../tmvc-path.js";

export type SpecifierClass =
  | { kind: "builtin"; specifier: string }
  | { kind: "bare"; specifier: string; packageName: string }
  | { kind: "relative"; specifier: string; resolvedRepoRel: string }
  | { kind: "alias"; specifier: string; resolvedRepoRel: string };

export interface TsconfigPaths {
  /** Repo-relative directory that `paths` targets resolve against. */
  baseDirRel: string;
  /** Alias pattern → target patterns (tsconfig `compilerOptions.paths`). */
  paths: Record<string, string[]>;
}

const BUILTINS = new Set(builtinModules);

export function isBuiltinSpecifier(spec: string): boolean {
  if (spec.startsWith("node:")) return true;
  const base = spec.split("/")[0] ?? spec;
  return BUILTINS.has(base);
}

/** `@scope/name/sub` → `@scope/name`; `name/sub` → `name`. */
export function bareSpecifierPackage(spec: string): string {
  const parts = spec.split("/");
  if (spec.startsWith("@") && parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  return parts[0] ?? spec;
}

function stripJsonComments(raw: string): string {
  const noBlock = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const noLine = noBlock.replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");
  return noLine.replace(/,(\s*[}\]])/g, "$1");
}

/** Read `compilerOptions.paths` from `<repo>/tsconfig.json` (no `extends` chasing). Null when absent. */
export function loadTsconfigPaths(repoRoot: string, tsconfigRel = "tsconfig.json"): TsconfigPaths | null {
  const abs = path.join(repoRoot, tsconfigRel);
  if (!fs.existsSync(abs)) return null;
  let parsed: { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
  try {
    parsed = JSON.parse(stripJsonComments(fs.readFileSync(abs, "utf8"))) as typeof parsed;
  } catch {
    return null;
  }
  const paths = parsed.compilerOptions?.paths;
  if (!paths || Object.keys(paths).length === 0) return null;
  const tsconfigDir = path.posix.dirname(normalizeRepoRelativePath(tsconfigRel));
  const baseUrl = parsed.compilerOptions?.baseUrl ?? ".";
  const baseDirRel = normalizeRepoRelativePath(path.posix.normalize(path.posix.join(tsconfigDir === "." ? "" : tsconfigDir, baseUrl)));
  return { baseDirRel: baseDirRel === "." ? "" : baseDirRel, paths };
}

function matchAliasPattern(spec: string, pattern: string): string | null {
  const star = pattern.indexOf("*");
  if (star === -1) return spec === pattern ? "" : null;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!spec.startsWith(prefix) || !spec.endsWith(suffix) || spec.length < prefix.length + suffix.length) return null;
  return spec.slice(prefix.length, spec.length - suffix.length);
}

function resolveAlias(spec: string, ts: TsconfigPaths): string | null {
  for (const [pattern, targets] of Object.entries(ts.paths)) {
    const wildcard = matchAliasPattern(spec, pattern);
    if (wildcard === null) continue;
    const target = targets[0];
    if (!target) continue;
    const substituted = target.replace("*", wildcard);
    const joined = path.posix.join(ts.baseDirRel, substituted);
    return normalizeRepoRelativePath(path.posix.normalize(joined));
  }
  return null;
}

function resolveRelative(importerRepoRel: string, spec: string): string {
  const dir = path.posix.dirname(normalizeRepoRelativePath(importerRepoRel));
  return normalizeRepoRelativePath(path.posix.normalize(path.posix.join(dir, spec)));
}

/**
 * Classify a module specifier for contract checks. Relative and alias specifiers resolve to a
 * repo-relative path (extension left as written; directory prefix checks do not need it). Alias
 * specifiers that match no tsconfig path are treated as bare packages.
 */
export function classifySpecifier(
  spec: string,
  importerRepoRel: string,
  tsconfigPaths: TsconfigPaths | null,
): SpecifierClass {
  if (spec.startsWith(".")) {
    return { kind: "relative", specifier: spec, resolvedRepoRel: resolveRelative(importerRepoRel, spec) };
  }
  if (spec.startsWith("/")) {
    return { kind: "relative", specifier: spec, resolvedRepoRel: normalizeRepoRelativePath(spec.slice(1)) };
  }
  if (isBuiltinSpecifier(spec)) return { kind: "builtin", specifier: spec };
  if (tsconfigPaths) {
    const resolved = resolveAlias(spec, tsconfigPaths);
    if (resolved !== null) return { kind: "alias", specifier: spec, resolvedRepoRel: resolved };
  }
  return { kind: "bare", specifier: spec, packageName: bareSpecifierPackage(spec) };
}
