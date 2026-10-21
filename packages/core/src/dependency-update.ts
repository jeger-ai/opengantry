import { canonicalJson } from "./canonical-json.js";

/**
 * The `dependency_update` structural kind of trusted automation (ADR-0057): what a dependency bot may change without
 * a mission. A `package.json` may only change the version strings of dependencies it already declares; an npm lockfile
 * may change freely, but every entry that is new or changed must resolve to an allowed registry with an integrity hash.
 * So a bot can bump, and nothing can add a package, a script, a git or tarball dependency, or another registry.
 */

type Json = unknown;

const DEPENDENCY_SECTIONS = new Set(["dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "overrides"]);
const LOCKFILE_TOP = new Set(["packages", "dependencies"]);

export type DependencyFileKind = "manifest" | "lockfile";

/** `package.json` is a manifest, `package-lock.json` and `npm-shrinkwrap.json` are lockfiles; anything else is null. */
export function dependencyFileKind(path: string): DependencyFileKind | null {
  const base = path.slice(path.lastIndexOf("/") + 1);
  if (base === "package.json") return "manifest";
  if (base === "package-lock.json" || base === "npm-shrinkwrap.json") return "lockfile";
  return null;
}

function isObject(v: Json): v is Record<string, Json> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function same(a: Json, b: Json): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

function sameKeys(a: Record<string, Json>, b: Record<string, Json>): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

/** A dependency section (or a nested `overrides` object): the same names, string values may differ. */
function sectionProblem(where: string, before: Json, after: Json): string | null {
  if (!isObject(before) || !isObject(after)) return same(before, after) ? null : `${where} changed shape`;
  if (!sameKeys(before, after)) return `${where}: a dependency was added or removed`;
  for (const name of Object.keys(after)) {
    const b = before[name];
    const a = after[name];
    if (typeof b === "string" && typeof a === "string") continue;
    const nested = sectionProblem(`${where}.${name}`, b, a);
    if (nested) return nested;
  }
  return null;
}

/** Why a `package.json` change is more than a version bump, or null when it is only that. */
export function manifestUpdateProblem(before: Json, after: Json): string | null {
  if (!isObject(before) || !isObject(after)) return "not a JSON object";
  if (!sameKeys(before, after)) return "a top-level field was added or removed";
  for (const key of Object.keys(after)) {
    if (DEPENDENCY_SECTIONS.has(key)) {
      const problem = sectionProblem(key, before[key], after[key]);
      if (problem) return problem;
    } else if (!same(before[key], after[key])) {
      return `${key} changed`;
    }
  }
  return null;
}

function entryProblem(where: string, entry: Json, registries: readonly string[]): string | null {
  if (!isObject(entry)) return `${where}: not an object`;
  if (entry.link === true) return `${where}: a new or changed link to a local package`;
  if (entry.inBundle === true) return null;
  const resolved = entry.resolved;
  if (typeof resolved !== "string") return `${where}: no resolved URL`;
  if (!registries.some((r) => resolved.startsWith(r))) return `${where}: resolves outside the allowed registries (${resolved})`;
  if (typeof entry.integrity !== "string" || entry.integrity.length === 0) return `${where}: no integrity hash`;
  return null;
}

/** lockfileVersion 2's legacy `dependencies` tree: every new or changed entry, at any depth. */
function legacyProblem(where: string, before: Json, after: Json, registries: readonly string[]): string | null {
  if (!isObject(after)) return null;
  const prev = isObject(before) ? before : {};
  for (const [name, entry] of Object.entries(after)) {
    const old = prev[name];
    if (same(old, entry)) continue;
    const here = `${where} ${name}`;
    const { dependencies: nested, requires: _requires, ...own } = isObject(entry) ? entry : {};
    const { dependencies: _oldNested, requires: _oldRequires, ...oldOwn } = isObject(old) ? old : {};
    if (!same(own, oldOwn)) {
      const problem = entryProblem(here, entry, registries);
      if (problem) return problem;
    }
    const deeper = legacyProblem(here, isObject(old) ? old.dependencies : undefined, nested, registries);
    if (deeper) return deeper;
  }
  return null;
}

/** Why an npm lockfile change is more than a registry update, or null (lockfileVersion 2 and 3). */
export function lockfileUpdateProblem(before: Json, after: Json, registries: readonly string[]): string | null {
  if (!isObject(before) || !isObject(after)) return "not a JSON object";
  for (const doc of [before, after]) {
    if (doc.lockfileVersion !== 2 && doc.lockfileVersion !== 3) return `lockfileVersion ${String(doc.lockfileVersion)} is not supported (2 or 3)`;
  }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!LOCKFILE_TOP.has(key) && !same(before[key], after[key])) return `${key} changed`;
  }
  const bp = isObject(before.packages) ? before.packages : {};
  const ap = isObject(after.packages) ? after.packages : {};
  const root = manifestUpdateProblem(bp[""] ?? {}, ap[""] ?? {});
  if (root) return `the root entry: ${root}`;
  for (const [key, entry] of Object.entries(ap)) {
    if (key === "" || same(bp[key], entry)) continue;
    const problem = entryProblem(key, entry, registries);
    if (problem) return problem;
  }
  return legacyProblem("dependencies", before.dependencies, after.dependencies, registries);
}
