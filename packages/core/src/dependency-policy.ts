import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { NPM_GRAPH_LIMITS, type NpmGraphLimits } from "./dependency-graph.js";

/**
 * The closed `dependencies` section of `verify.yaml` (`opengantry.dependency-policy.v1`, issue #355 slice 2,
 * ADR-0062 decision 2). Pure: the verify contract reader hands in the parsed YAML value and turns a
 * {@link DependencyPolicyError} into `GXT_VERIFY_CONTRACT_INVALID`. Every field is closed; a merge only tightens.
 */

const DEPENDENCY_POLICY_SCHEMA = "opengantry.dependency-policy.v1";
export const DEFAULT_APPROVAL_REFS: readonly string[] = [".gitagent/dependency-approvals/"];

export type DependencyMode = "audit" | "enforce";
type LifecycleDefault = "deny" | "allow-approved";

/** v1 knows one value per source: hold. A later version may admit a source with an equally exact identity. */
interface DependencySourcesPolicy {
  git: "hold";
  url: "hold";
  fileOutsideWorkspaces: "hold";
  bundled: "hold";
}

export interface DependencyPolicy {
  schema: typeof DEPENDENCY_POLICY_SCHEMA;
  mode: DependencyMode;
  npm: { lockfileVersions: (2 | 3)[]; npmVersion: string };
  /** Canonical registry bases (https origin plus path ending in `/`), sorted. */
  registries: string[];
  approvedBaselineDigest: string | null;
  /** Repository-relative directories ending in `/`, sorted. */
  approvalRefs: string[];
  lifecycle: LifecycleDefault;
  sources: DependencySourcesPolicy;
  limits: NpmGraphLimits;
}

export class DependencyPolicyError extends Error {}

type Obj = Record<string, unknown>;

const SHA256 = /^[0-9a-f]{64}$/;
const NPM_11 = /^11\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function fail(message: string): never {
  throw new DependencyPolicyError(message);
}

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function mapping(v: unknown, where: string, keys: readonly string[], optional = true): Obj {
  if ((v === undefined || v === null) && optional) return {};
  if (!isObj(v)) fail(`${where} must be a mapping`);
  for (const k of Object.keys(v)) if (!keys.includes(k)) fail(`${where}: unknown key "${k}"`);
  return v;
}

function oneOf<T extends string>(v: unknown, where: string, values: readonly T[], fallback?: T): T {
  if ((v === undefined || v === null) && fallback !== undefined) return fallback;
  if (typeof v !== "string" || !(values as readonly string[]).includes(v)) fail(`${where} must be ${values.join(" or ")}`);
  return v as T;
}

function list(v: unknown, where: string): unknown[] {
  if (!Array.isArray(v)) fail(`${where} must be a list`);
  return v;
}

const sorted = <T>(xs: Iterable<T>): T[] => [...new Set(xs)].sort();

/**
 * The canonical base of a registry URL: https only, no credentials, query or fragment, lower-case host, default port
 * dropped, path ending in `/`. Compared by equality with the graph's registry base, never as a string prefix.
 */
export function canonicalRegistry(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail(`${JSON.stringify(raw)} is not a URL`);
  }
  if (url.protocol !== "https:") fail("a registry must be an https URL");
  if (url.username !== "" || url.password !== "") fail("a registry URL must not carry credentials");
  if (url.search !== "" || url.hash !== "") fail("a registry URL must not carry a query or fragment");
  const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return `${url.origin}${path}`;
}

function registries(v: unknown): string[] {
  return sorted(
    list(v, "registries").map((r, i) => {
      if (typeof r !== "string") fail(`registries[${String(i)}] must be a string`);
      try {
        return canonicalRegistry(r);
      } catch (e) {
        return fail(`registries[${String(i)}]: ${(e as Error).message}`);
      }
    }),
  );
}

function npmEcosystem(v: unknown): DependencyPolicy["npm"] {
  const eco = mapping(v, "ecosystems", ["npm"], false);
  const npm = mapping(eco.npm, "ecosystems.npm", ["lockfile_versions", "npm_version"], false);
  const versions = list(npm.lockfile_versions, "ecosystems.npm.lockfile_versions");
  if (versions.length === 0 || versions.some((x) => x !== 2 && x !== 3) || new Set(versions).size !== versions.length) {
    fail("ecosystems.npm.lockfile_versions must list 2, 3 or both, once each");
  }
  if (typeof npm.npm_version !== "string" || !NPM_11.test(npm.npm_version)) fail("ecosystems.npm.npm_version must be an exact 11.x version (11.6.2)");
  return { lockfileVersions: sorted(versions as (2 | 3)[]), npmVersion: npm.npm_version };
}

function approvalRefs(v: unknown): string[] {
  if (v === undefined || v === null) return [...DEFAULT_APPROVAL_REFS];
  return sorted(
    list(v, "approval_refs").map((r, i) => {
      const ok = typeof r === "string" && r.endsWith("/") && !r.startsWith("/") && !r.includes("\\") && !r.split("/").slice(0, -1).some((s) => s === "" || s === "." || s === "..");
      if (!ok) fail(`approval_refs[${String(i)}] must be a repository-relative directory ending in "/" without "." or ".."`);
      return r as string;
    }),
  );
}

function sources(v: unknown): DependencySourcesPolicy {
  const s = mapping(v, "sources", ["git", "url", "file_outside_workspaces", "bundled"]);
  const hold = (k: string): "hold" => oneOf(s[k], `sources.${k}`, ["hold"] as const, "hold");
  return { git: hold("git"), url: hold("url"), fileOutsideWorkspaces: hold("file_outside_workspaces"), bundled: hold("bundled") };
}

function limit(v: unknown, where: string, max: number): number {
  if (v === undefined || v === null) return max;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) fail(`${where} must be a positive integer`);
  if (v > max) fail(`${where} must be at most ${String(max)}`);
  return v;
}

function limits(v: unknown): NpmGraphLimits {
  const l = mapping(v, "limits", ["max_lockfile_bytes", "max_nodes", "max_depth"]);
  return {
    maxLockfileBytes: limit(l.max_lockfile_bytes, "limits.max_lockfile_bytes", NPM_GRAPH_LIMITS.maxLockfileBytes),
    maxNodes: limit(l.max_nodes, "limits.max_nodes", NPM_GRAPH_LIMITS.maxNodes),
    maxDepth: limit(l.max_depth, "limits.max_depth", NPM_GRAPH_LIMITS.maxDepth),
  };
}

const KEYS = ["schema", "mode", "ecosystems", "registries", "approved_baseline_digest", "approval_refs", "lifecycle", "sources", "limits"];

/** The `dependencies` section as read from YAML (already alias-free and duplicate-free), or a {@link DependencyPolicyError}. */
export function parseDependencyPolicy(raw: unknown): DependencyPolicy {
  const d = mapping(raw, "dependencies", KEYS, false);
  if (d.schema !== DEPENDENCY_POLICY_SCHEMA) fail(`schema must be ${DEPENDENCY_POLICY_SCHEMA}`);
  const baseline = d.approved_baseline_digest;
  if (baseline !== undefined && baseline !== null && (typeof baseline !== "string" || !SHA256.test(baseline))) {
    fail("approved_baseline_digest must be a sha256 (64 lower-case hex digits)");
  }
  return {
    schema: DEPENDENCY_POLICY_SCHEMA,
    mode: oneOf(d.mode, "mode", ["audit", "enforce"] as const),
    npm: npmEcosystem(d.ecosystems),
    registries: registries(d.registries),
    approvedBaselineDigest: (baseline as string | undefined) ?? null,
    approvalRefs: approvalRefs(d.approval_refs),
    lifecycle: oneOf(mapping(d.lifecycle, "lifecycle", ["default"]).default, "lifecycle.default", ["deny", "allow-approved"] as const, "deny"),
    sources: sources(d.sources),
    limits: limits(d.limits),
  };
}

/** The policy revision an approval binds: sha256 of the canonical JSON of the normalized effective section. */
export function dependencyPolicyRevision(policy: DependencyPolicy): string {
  return createHash("sha256").update(canonicalJson(policy)).digest("hex");
}

function sameOrFail<T>(floor: T | null, local: T | null, field: string): T | null {
  if (floor === null) return local;
  if (local !== null && local !== floor) fail(`${field} differs from the floor`);
  return local;
}

/**
 * Tighten-only (ADR-0062 decision 2, as RULES §8): registries, lockfile versions and approval locations are
 * intersected; enforce beats audit, deny beats allow-approved, lower limits win, sources stay held. A local section
 * may drop the floor's baseline (tighter) but not name another one, and may not change the npm pin.
 */
export function mergeDependencyPolicy(floor: DependencyPolicy | null, local: DependencyPolicy | null): DependencyPolicy | null {
  if (!floor || !local) return floor ?? local;
  if (floor.npm.npmVersion !== local.npm.npmVersion) fail("ecosystems.npm.npm_version differs from the floor");
  const both = <T>(a: readonly T[], b: readonly T[]): T[] => sorted(a.filter((x) => b.includes(x)));
  return {
    schema: DEPENDENCY_POLICY_SCHEMA,
    mode: floor.mode === "enforce" || local.mode === "enforce" ? "enforce" : "audit",
    npm: { lockfileVersions: both(floor.npm.lockfileVersions, local.npm.lockfileVersions), npmVersion: floor.npm.npmVersion },
    registries: both(floor.registries, local.registries),
    approvedBaselineDigest: sameOrFail(floor.approvedBaselineDigest, local.approvedBaselineDigest, "approved_baseline_digest"),
    approvalRefs: both(floor.approvalRefs, local.approvalRefs),
    lifecycle: floor.lifecycle === "deny" || local.lifecycle === "deny" ? "deny" : "allow-approved",
    sources: { git: "hold", url: "hold", fileOutsideWorkspaces: "hold", bundled: "hold" },
    limits: {
      maxLockfileBytes: Math.min(floor.limits.maxLockfileBytes, local.limits.maxLockfileBytes),
      maxNodes: Math.min(floor.limits.maxNodes, local.limits.maxNodes),
      maxDepth: Math.min(floor.limits.maxDepth, local.limits.maxDepth),
    },
  };
}
