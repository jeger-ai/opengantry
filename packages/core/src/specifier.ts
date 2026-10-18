import { builtinModules } from "node:module";
import path from "node:path";
import { normalizeRepoRelativePath } from "./law.js";

/** Module specifier classification and the import ban matcher (ADR-0052 A3): pure, no filesystem; tsconfig paths are passed in. */
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

/** Exact or prefix match of a bare specifier against a banned (or allowed) entry: `pkg` matches `pkg` and `pkg/sub`. */
export function importMatchesBan(specifier: string, banned: string): boolean {
  return specifier === banned || specifier.startsWith(`${banned}/`);
}
