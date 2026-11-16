import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { globToRegExp } from "./path-glob.js";

/**
 * The npm dependency graph of a `package-lock.json` / `npm-shrinkwrap.json` (lockfileVersion 2 and 3) and the diff of
 * two graphs: issue #355 slice 1, ADR-0062. Pure and bounded: the lockfile is at most 20 MiB, the graph at most 10,000
 * nodes and 32 nested `node_modules` levels, the legacy v2 tree is walked to the same depth. A lockfile this module
 * cannot read without losing information (an unknown field, a wrong type, a v2 legacy tree that disagrees with
 * `packages`) is a hold, never a partial graph. It decides nothing: admission policy is a later slice, and
 * `dependency-update.ts` (ADR-0057) keeps its own checks.
 */

type Json = unknown;
type Obj = Record<string, Json>;

export const NPM_GRAPH_SCHEMA = "opengantry.npm-dependency-graph.v1";
export const NPM_GRAPH_DIFF_SCHEMA = "opengantry.npm-dependency-graph-diff.v1";

export interface NpmGraphLimits {
  maxLockfileBytes: number;
  maxNodes: number;
  maxDepth: number;
}

export const NPM_GRAPH_LIMITS: NpmGraphLimits = { maxLockfileBytes: 20 * 1024 * 1024, maxNodes: 10_000, maxDepth: 32 };

export type GraphHoldCode =
  | "lockfile_too_large"
  | "malformed_json"
  | "unsupported_lockfile"
  | "too_many_nodes"
  | "too_deep"
  | "lossy_entry"
  | "inconsistent_lockfile";

export interface GraphHold {
  status: "hold";
  code: GraphHoldCode;
  location: string | null;
  detail: string;
}

/**
 * Where a node's code comes from; `ref` is canonical (no credentials), never the raw `resolved` string. `external` is
 * a package npm describes inside a local folder outside the project (`../x/node_modules/y`, for a `file:` dependency):
 * this lockfile does not install it.
 */
export interface DependencySource {
  kind: "workspace" | "local" | "external" | "link" | "registry" | "git" | "url" | "file" | "bundled" | "unresolved";
  ref: string | null;
  credentials: boolean;
}

export type EdgeMap = Record<string, Record<string, string>>;

export interface NpmGraphNode {
  location: string;
  name: string;
  alias: string | null;
  version: string | null;
  source: DependencySource;
  integrity: string | null;
  flags: string[];
  installScript: boolean;
  platform: { os: string[]; cpu: string[]; libc: string[] } | null;
  edges: EdgeMap;
  direct: boolean;
}

export interface NpmGraphRoot {
  name: string | null;
  version: string | null;
  edges: EdgeMap;
  workspaces: string[];
  /** Lifecycle scripts of the root `package.json`; null when no manifest was given. */
  lifecycleScripts: Record<string, string> | null;
}

export interface NpmGraph {
  schema: typeof NPM_GRAPH_SCHEMA;
  lockfileVersion: 2 | 3;
  root: NpmGraphRoot;
  nodes: NpmGraphNode[];
  digest: string;
}

export type NpmGraphResult = { status: "ok"; graph: NpmGraph } | GraphHold;

class Hold extends Error {
  constructor(
    readonly code: GraphHoldCode,
    readonly location: string | null,
    detail: string,
  ) {
    super(detail);
  }
}

const TOP_KEYS = new Set(["name", "version", "lockfileVersion", "requires", "packages", "dependencies"]);
const EDGE_KEYS = ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"] as const;
const FLAG_KEYS = ["dev", "optional", "devOptional", "peer", "inBundle", "hasShrinkwrap", "extraneous"] as const;
const STRING_KEYS = ["name", "version", "resolved", "integrity", "license", "deprecated"] as const;
const PLATFORM_KEYS = ["os", "cpu", "libc"] as const;
/** Fields npm writes that say nothing about what is installed or executed; read and dropped. */
const IGNORED_KEYS = new Set(["engines", "funding", "bin", "peerDependenciesMeta", "bundleDependencies", "bundledDependencies"]);
const ENTRY_KEYS = new Set<string>([
  ...EDGE_KEYS,
  ...FLAG_KEYS,
  ...STRING_KEYS,
  ...PLATFORM_KEYS,
  ...IGNORED_KEYS,
  "link",
  "hasInstallScript",
  "workspaces",
]);
/** npm lifecycle scripts that run during install (`npm install`, `npm ci`, `npm rebuild`). */
const LIFECYCLE_SCRIPTS = ["preinstall", "install", "postinstall", "prepublish", "preprepare", "prepare", "postprepare", "dependencies"];
const NM = "node_modules/";

function isObj(v: Json): v is Obj {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function sha256(value: Json): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function parseJson(text: string, what: string, limits: NpmGraphLimits): Json {
  if (Buffer.byteLength(text, "utf8") > limits.maxLockfileBytes) {
    throw new Hold("lockfile_too_large", null, `${what} is larger than ${limits.maxLockfileBytes} bytes`);
  }
  try {
    return JSON.parse(text) as Json;
  } catch (e) {
    throw new Hold("malformed_json", null, `${what} is not JSON (${e instanceof Error ? e.message : String(e)})`);
  }
}

function str(entry: Obj, key: string, at: string): string | null {
  const v = entry[key];
  if (v === undefined) return null;
  if (typeof v !== "string") throw new Hold("lossy_entry", at, `${key} is not a string`);
  return v;
}

function strings(v: Json, key: string, at: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new Hold("lossy_entry", at, `${key} is not a list of strings`);
  return [...(v as string[])].sort();
}

function edges(entry: Obj, at: string): EdgeMap {
  const out: EdgeMap = {};
  for (const kind of EDGE_KEYS) {
    const map = entry[kind];
    if (map === undefined) continue;
    if (!isObj(map) || Object.values(map).some((r) => typeof r !== "string")) throw new Hold("lossy_entry", at, `${kind} is not a map of strings`);
    out[kind] = Object.fromEntries(Object.entries(map as Record<string, string>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }
  return out;
}

function flags(entry: Obj, at: string): string[] {
  const out: string[] = [];
  for (const key of [...FLAG_KEYS, "link", "hasInstallScript"]) {
    const v = entry[key];
    if (v !== undefined && typeof v !== "boolean") throw new Hold("lossy_entry", at, `${key} is not a boolean`);
    if (v === true && (FLAG_KEYS as readonly string[]).includes(key)) out.push(key);
  }
  return out.sort();
}

/** The installed folder name a location names (`a/node_modules/@s/b` → `@s/b`), or a hold. */
function installedName(location: string): string {
  const name = location.slice(location.lastIndexOf(NM) + NM.length);
  const parts = name.split("/");
  const ok = parts[0]!.startsWith("@") ? parts.length === 2 && parts[0]!.length > 1 && parts[1]!.length > 0 : parts.length === 1 && name.length > 0;
  if (!ok) throw new Hold("lossy_entry", location, "location does not end in a package name");
  return name;
}

function checkLocation(location: string, limits: NpmGraphLimits): void {
  const segments = location.split("/");
  if (location.startsWith("/") || location.includes("\\") || segments.some((s) => s === "" || s === ".")) {
    throw new Hold("lossy_entry", location, "not a relative package location");
  }
  if (segments.filter((s) => s === "node_modules").length > limits.maxDepth) {
    throw new Hold("too_deep", location, `more than ${limits.maxDepth} nested node_modules levels`);
  }
}

function isInstalled(location: string): boolean {
  return location.startsWith(NM) || location.includes(`/${NM}`);
}

function canonicalUrl(raw: string): { url: URL; credentials: boolean } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const http = url.protocol === "https:" || url.protocol === "http:";
  const credentials = url.password !== "" || (http && url.username !== "");
  url.password = "";
  if (http) url.username = "";
  return { url, credentials };
}

/** The registry base of a tarball URL (`https://r.example/npm/` for `…/npm/@s/x/-/x-1.0.0.tgz`), else null. */
function registryBase(url: URL, name: string): string | null {
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.search !== "" || url.hash !== "") return null;
  for (const spelled of [name, name.replace("/", "%2f"), name.replace("/", "%2F")]) {
    const marker = `/${spelled}/-/`;
    const at = url.pathname.lastIndexOf(marker);
    const file = url.pathname.slice(at + marker.length);
    if (at >= 0 && !file.includes("/") && file.endsWith(".tgz")) return `${url.origin}${url.pathname.slice(0, at)}/`;
  }
  return null;
}

function remoteSource(resolved: string, name: string, at: string): DependencySource {
  if (resolved.startsWith("file:")) return { kind: "file", ref: resolved, credentials: false };
  const git = resolved.startsWith("git+") || resolved.startsWith("git:") || resolved.startsWith("github:");
  const parsed = canonicalUrl(resolved.startsWith("github:") ? `git+https://github.com/${resolved.slice(7)}` : resolved);
  if (!parsed) throw new Hold("lossy_entry", at, "resolved is not a URL, file: or git reference");
  if (git) return { kind: "git", ref: parsed.url.href, credentials: parsed.credentials };
  const base = registryBase(parsed.url, name);
  if (base) return { kind: "registry", ref: base, credentials: parsed.credentials };
  return { kind: "url", ref: parsed.url.href, credentials: parsed.credentials };
}

function sourceOf(location: string, entry: Obj, name: string, workspaces: readonly string[]): DependencySource {
  const resolved = str(entry, "resolved", location);
  if (entry.link === true) return { kind: "link", ref: resolved, credentials: false };
  if (location.startsWith("../") && isInstalled(location)) return { kind: "external", ref: location, credentials: false };
  if (!isInstalled(location)) {
    const ws = workspaces.some((g) => globToRegExp(g).test(location));
    return { kind: ws ? "workspace" : "local", ref: location, credentials: false };
  }
  if (entry.inBundle === true) return { kind: "bundled", ref: null, credentials: false };
  if (resolved === null) return { kind: "unresolved", ref: null, credentials: false };
  return remoteSource(resolved, name, location);
}

function platform(entry: Obj, at: string): NpmGraphNode["platform"] {
  if (PLATFORM_KEYS.every((k) => entry[k] === undefined)) return null;
  return { os: strings(entry.os, "os", at), cpu: strings(entry.cpu, "cpu", at), libc: strings(entry.libc, "libc", at) };
}

/** Every field known and of the expected type, else a hold (the root entry too). */
function checkEntry(entry: Json, at: string): Obj {
  if (!isObj(entry)) throw new Hold("lossy_entry", at, "entry is not an object");
  const unknown = Object.keys(entry).find((k) => !ENTRY_KEYS.has(k));
  if (unknown !== undefined) throw new Hold("lossy_entry", at, `unknown field ${unknown}`);
  for (const k of STRING_KEYS) str(entry, k, at);
  flags(entry, at);
  edges(entry, at);
  platform(entry, at);
  return entry;
}

function readNode(location: string, raw: Json, workspaces: readonly string[], limits: NpmGraphLimits): NpmGraphNode {
  checkLocation(location, limits);
  const entry = checkEntry(raw, location);
  const folder = isInstalled(location) ? installedName(location) : location.slice(location.lastIndexOf("/") + 1);
  const declared = str(entry, "name", location);
  const name = declared ?? folder;
  return {
    location,
    name,
    alias: isInstalled(location) && name !== folder ? folder : null,
    version: str(entry, "version", location),
    source: sourceOf(location, entry, name, workspaces),
    integrity: str(entry, "integrity", location),
    flags: flags(entry, location),
    installScript: entry.hasInstallScript === true,
    platform: platform(entry, location),
    edges: edges(entry, location),
    direct: false,
  };
}

/** The package a location is installed for: `""` (root), a local folder, or another installed package. */
function parentOf(location: string): string {
  const at = location.lastIndexOf(`/${NM}`);
  return at < 0 ? "" : location.slice(0, at);
}

function declares(e: EdgeMap, name: string): boolean {
  return EDGE_KEYS.some((k) => e[k]?.[name] !== undefined);
}

/** Direct: installed for the root or a local package that declares it, or hoisted to the top and declared by one. */
function markDirect(nodes: NpmGraphNode[], root: NpmGraphRoot): void {
  const localEdges = new Map<string, EdgeMap>([["", root.edges]]);
  for (const n of nodes) if (!isInstalled(n.location)) localEdges.set(n.location, n.edges);
  for (const n of nodes) {
    if (!isInstalled(n.location)) continue;
    const folder = n.alias ?? n.name;
    const parent = parentOf(n.location);
    const owner = localEdges.get(parent);
    const hoisted = parent === "" && [...localEdges.values()].some((e) => declares(e, folder));
    n.direct = (owner !== undefined && declares(owner, folder)) || hoisted;
  }
}

function lifecycleScripts(manifest: Json): Record<string, string> {
  if (!isObj(manifest)) throw new Hold("lossy_entry", "package.json", "manifest is not an object");
  const scripts = manifest.scripts ?? {};
  if (!isObj(scripts)) throw new Hold("lossy_entry", "package.json", "scripts is not an object");
  const out: Record<string, string> = {};
  for (const name of LIFECYCLE_SCRIPTS) {
    const s = scripts[name];
    if (s === undefined) continue;
    if (typeof s !== "string") throw new Hold("lossy_entry", "package.json", `scripts.${name} is not a string`);
    out[name] = s;
  }
  return out;
}

/** lockfileVersion 2's legacy tree must agree with `packages`: npm 6 installs from it. */
function checkLegacy(tree: Json, prefix: string, depth: number, packages: Obj, budget: { left: number }, limits: NpmGraphLimits): void {
  if (tree === undefined) return;
  if (!isObj(tree)) throw new Hold("lossy_entry", prefix || null, "legacy dependencies is not an object");
  if (depth > limits.maxDepth) throw new Hold("too_deep", prefix, `legacy tree deeper than ${limits.maxDepth}`);
  for (const [name, entry] of Object.entries(tree)) {
    budget.left -= 1;
    if (budget.left < 0) throw new Hold("too_many_nodes", null, `legacy tree has more than ${limits.maxNodes} entries`);
    const location = `${prefix}${NM}${name}`;
    const current = packages[location];
    if (!isObj(entry) || !isObj(current)) throw new Hold("inconsistent_lockfile", location, "legacy entry has no packages entry");
    for (const key of ["integrity", "resolved"]) {
      if (typeof entry[key] === "string" && typeof current[key] === "string" && entry[key] !== current[key]) {
        throw new Hold("inconsistent_lockfile", location, `legacy ${key} differs from packages`);
      }
    }
    const v = entry.version;
    if (typeof v === "string" && !v.includes(":") && typeof current.version === "string" && v !== current.version) {
      throw new Hold("inconsistent_lockfile", location, "legacy version differs from packages");
    }
    checkLegacy(entry.dependencies, `${location}/`, depth + 1, packages, budget, limits);
  }
}

function readTop(lock: Json): { version: 2 | 3; packages: Obj; lock: Obj } {
  if (!isObj(lock)) throw new Hold("unsupported_lockfile", null, "lockfile is not a JSON object");
  const version = lock.lockfileVersion;
  if (version !== 2 && version !== 3) throw new Hold("unsupported_lockfile", null, `lockfileVersion ${String(version)} is not supported (2 or 3)`);
  const unknown = Object.keys(lock).find((k) => !TOP_KEYS.has(k));
  if (unknown !== undefined) throw new Hold("lossy_entry", null, `unknown top-level field ${unknown}`);
  if (version === 3 && lock.dependencies !== undefined) throw new Hold("lossy_entry", null, "lockfileVersion 3 with a legacy dependencies tree");
  if (!isObj(lock.packages) || !isObj(lock.packages[""])) throw new Hold("unsupported_lockfile", null, "no packages map with a root entry");
  return { version, packages: lock.packages, lock };
}

function buildGraph(lockText: string, manifestText: string | undefined, limits: NpmGraphLimits): NpmGraph {
  const { version, packages, lock } = readTop(parseJson(lockText, "lockfile", limits));
  const keys = Object.keys(packages).filter((k) => k !== "");
  if (keys.length > limits.maxNodes) throw new Hold("too_many_nodes", null, `more than ${limits.maxNodes} packages`);
  const rootEntry = packages[""] as Obj;
  const ws = rootEntry.workspaces === undefined ? [] : strings(rootEntry.workspaces, "workspaces", "");
  checkEntry(rootEntry, "");
  const root: NpmGraphRoot = {
    name: str(rootEntry, "name", ""),
    version: str(rootEntry, "version", ""),
    edges: edges(rootEntry, ""),
    workspaces: ws,
    lifecycleScripts: manifestText === undefined ? null : lifecycleScripts(parseJson(manifestText, "package.json", limits)),
  };
  const nodes = keys.sort().map((k) => readNode(k, packages[k], ws, limits));
  if (version === 2) checkLegacy(lock.dependencies, "", 0, packages, { left: limits.maxNodes }, limits);
  markDirect(nodes, root);
  const body = { schema: NPM_GRAPH_SCHEMA, lockfileVersion: version, root, nodes } as const;
  return { ...body, digest: sha256(body) };
}

/** Parse an npm lockfile (and optionally the root `package.json`) into a normalized graph, or an explicit hold. */
export function parseNpmLockfile(lockText: string, options: { manifest?: string; limits?: Partial<NpmGraphLimits> } = {}): NpmGraphResult {
  const limits = { ...NPM_GRAPH_LIMITS, ...options.limits };
  try {
    return { status: "ok", graph: buildGraph(lockText, options.manifest, limits) };
  } catch (e) {
    if (e instanceof Hold) return { status: "hold", code: e.code, location: e.location, detail: e.message };
    if (e instanceof RangeError) return { status: "hold", code: "too_deep", location: null, detail: e.message };
    throw e;
  }
}

export interface NodeSummary {
  name: string;
  alias: string | null;
  version: string | null;
  source: DependencySource;
  integrity: string | null;
  installScript: boolean;
}

export interface GraphChange {
  change: "added" | "removed" | "updated";
  location: string;
  direct: boolean;
  fields: string[];
  before: NodeSummary | null;
  after: NodeSummary | null;
}

export interface NpmGraphDiff {
  schema: typeof NPM_GRAPH_DIFF_SCHEMA;
  before: string;
  after: string;
  root: string[];
  changes: GraphChange[];
  newIdentities: string[];
  newInstallScripts: string[];
}

const NODE_FIELDS = ["name", "alias", "version", "source", "integrity", "flags", "installScript", "platform", "edges", "direct"] as const;
const ROOT_FIELDS = ["name", "version", "edges", "workspaces", "lifecycleScripts"] as const;

function summary(n: NpmGraphNode): NodeSummary {
  return { name: n.name, alias: n.alias, version: n.version, source: n.source, integrity: n.integrity, installScript: n.installScript };
}

/** What a node is, independent of where it is installed: hoisting moves change locations, not identities. */
export function nodeIdentity(n: NpmGraphNode): string {
  return `${n.name}@${n.version ?? "?"} ${n.source.kind}:${n.source.ref ?? ""} ${n.integrity ?? "-"}`;
}

function changed<T extends object>(a: T, b: T, fields: readonly (keyof T & string)[]): string[] {
  return fields.filter((f) => canonicalJson(a[f]) !== canonicalJson(b[f]));
}

/** Every added, removed and updated node by location, the root's changed fields, new identities and install scripts. */
export function diffNpmGraphs(before: NpmGraph, after: NpmGraph): NpmGraphDiff {
  const old = new Map(before.nodes.map((n) => [n.location, n]));
  const cur = new Map(after.nodes.map((n) => [n.location, n]));
  const changes: GraphChange[] = [];
  for (const location of [...new Set([...old.keys(), ...cur.keys()])].sort()) {
    const b = old.get(location);
    const a = cur.get(location);
    if (b === undefined && a !== undefined) changes.push({ change: "added", location, direct: a.direct, fields: [], before: null, after: summary(a) });
    else if (a === undefined && b !== undefined) changes.push({ change: "removed", location, direct: b.direct, fields: [], before: summary(b), after: null });
    else if (a !== undefined && b !== undefined) {
      const fields = changed(b, a, NODE_FIELDS);
      if (fields.length > 0) changes.push({ change: "updated", location, direct: a.direct || b.direct, fields, before: summary(b), after: summary(a) });
    }
  }
  const known = new Set(before.nodes.map(nodeIdentity));
  const scripted = new Set(before.nodes.filter((n) => n.installScript).map(nodeIdentity));
  return {
    schema: NPM_GRAPH_DIFF_SCHEMA,
    before: before.digest,
    after: after.digest,
    root: changed(before.root, after.root, ROOT_FIELDS),
    changes,
    newIdentities: [...new Set(after.nodes.map(nodeIdentity).filter((id) => !known.has(id)))].sort(),
    newInstallScripts: after.nodes.filter((n) => n.installScript && !scripted.has(nodeIdentity(n))).map((n) => n.location).sort(),
  };
}
