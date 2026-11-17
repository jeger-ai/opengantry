import { createHash } from "node:crypto";
import { admissionCapabilityReport } from "./admission-capabilities.js";
import { INSTALL_SCRIPTS } from "./dependency-approval.js";
import type { NpmGraph, NpmGraphNode } from "./dependency-graph.js";
import type { TarballContents } from "./dependency-tarball.js";
import type { DependencyInstallReceiptSchema } from "./schemas/dependency-install-schema.js";
import type { VerifyDependencies } from "./schemas/verify-dependencies-schema.js";

/**
 * The pure half of `gantry npm ci` (issue #355 slice 4, ADR-0062 decision 5): which tarballs an admitted graph needs,
 * whether fetched bytes match the lockfile's integrity, whether a URL or a redirect stays inside the policy's
 * registries, whether a tarball's own `package.json` agrees with what the lockfile declared, whether the installed
 * `node_modules` is exactly the admitted graph, and whether an environment for lifecycle scripts is proven. No fs,
 * process or network: the executor in `packages/missions/src/npm-ci/` performs every effect and asks these
 * functions. Nothing here claims prevention.
 */

export const DEPENDENCY_INSTALL_SCHEMA = "opengantry.dependency-install.v1" as const;

export type InstallSeverity = "fail" | "hold" | "info";

export interface InstallReason {
  code: string;
  severity: InstallSeverity;
  /** Graph location (`""` is the root), URL or path the reason is about, or null. */
  location: string | null;
  detail: string;
}

const DETAIL_MAX = 300;

export function installReason(code: string, severity: InstallSeverity, location: string | null, detail: string): InstallReason {
  return { code, severity, location, detail: detail.length > DETAIL_MAX ? `${detail.slice(0, DETAIL_MAX)}…` : detail };
}

/** A hold or fail refuses the install; info is reported only. */
/** An install-time script name npm runs for a dependency. */
export type InstallScript = (typeof INSTALL_SCRIPTS)[number];

export const refuses = (reasons: readonly InstallReason[]): boolean => reasons.some((r) => r.severity !== "info");

// --- integrity -------------------------------------------------------------------------------------------------

const STRONG = ["sha512", "sha384", "sha256"] as const;

export type IntegrityCheck = { status: "match" } | { status: "mismatch" | "weak" | "invalid"; detail: string };

/**
 * Check bytes against an SRI `integrity` string. Every strong hash it lists (sha512, sha384, sha256) must match;
 * a string that lists only sha1 or md5 is `weak` and refused, as is one with no readable hash.
 */
export function checkIntegrity(integrity: string | null, bytes: Uint8Array): IntegrityCheck {
  if (integrity === null || integrity.trim() === "") return { status: "invalid", detail: "the lockfile entry has no integrity" };
  const tokens = integrity.trim().split(/\s+/).map((t) => {
    const dash = t.indexOf("-");
    return { alg: dash > 0 ? t.slice(0, dash) : "", digest: (dash > 0 ? t.slice(dash + 1) : "").replace(/\?.*$/, "") };
  });
  const strong = tokens.filter((t) => (STRONG as readonly string[]).includes(t.alg) && /^[A-Za-z0-9+/]+=*$/.test(t.digest));
  if (strong.length === 0) {
    const known = tokens.some((t) => t.alg === "sha1" || t.alg === "md5");
    return known ? { status: "weak", detail: "the lockfile lists only sha1 or md5 integrity" } : { status: "invalid", detail: "no readable sha512, sha384 or sha256 integrity" };
  }
  for (const t of strong) {
    const got = createHash(t.alg).update(bytes).digest("base64");
    if (got !== t.digest) return { status: "mismatch", detail: `${t.alg} of the fetched bytes is ${got.slice(0, 16)}…, the lockfile says ${t.digest.slice(0, 16)}…` };
  }
  return { status: "match" };
}

// --- URLs ------------------------------------------------------------------------------------------------------

function parse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** A refused URL: the reason code is decided where the check is made, never from the message text. */
export interface UrlRefusal {
  code: "url_credentials" | "fetch_refused" | "redirect_refused";
  detail: string;
}

const refusal = (code: UrlRefusal["code"], detail: string): UrlRefusal => ({ code, detail });

/** Why the first URL of a fetch may not be requested: https, no credentials, under one policy registry base. */
export function fetchUrlProblem(raw: string, registries: readonly string[]): UrlRefusal | null {
  const url = parse(raw);
  if (!url) return refusal("fetch_refused", "not a URL");
  if (url.username !== "" || url.password !== "") return refusal("url_credentials", "the URL carries credentials");
  if (url.protocol !== "https:") return refusal("fetch_refused", "not an https URL");
  if (url.search !== "" || url.hash !== "") return refusal("fetch_refused", "the URL carries a query or fragment");
  // Registry bases end in "/", so a prefix of the normalized href is a path-boundary match, never a host extension.
  if (!registries.some((r) => url.href.startsWith(r))) return refusal("fetch_refused", "not under a policy registry");
  return null;
}

/** Why a redirect may not be followed: the target must be https, without credentials, under a policy registry's base path. */
export function redirectProblem(from: string, location: string, registries: readonly string[]): UrlRefusal | null {
  const base = parse(from);
  let target: URL;
  try {
    target = new URL(location, base ?? undefined);
  } catch {
    return refusal("redirect_refused", "the redirect target is not a URL");
  }
  if (target.username !== "" || target.password !== "") return refusal("url_credentials", "the redirect target carries credentials");
  if (target.protocol !== "https:") return refusal("redirect_refused", `the redirect goes to ${target.protocol} instead of https`);
  // Bases end in "/", so a prefix of the normalized href is a path-boundary match, as for the lockfile URL.
  if (!registries.some((r) => target.href.startsWith(r))) return refusal("redirect_refused", `the redirect goes to ${target.origin}${target.pathname}, outside the policy registries`);
  return null;
}

// --- plan ------------------------------------------------------------------------------------------------------

export interface InstallFetch {
  location: string;
  name: string;
  version: string;
  /** The lockfile's `resolved` URL, exactly as written. */
  resolved: string;
  integrity: string;
  installScript: boolean;
}

/** Packages npm leaves out on a platform they do not support: optional, with a platform condition. */
function platformOptional(n: NpmGraphNode): boolean {
  const optional = n.flags.includes("optional") || n.flags.includes("devOptional");
  return optional && n.platform !== null && n.platform.os.length + n.platform.cpu.length + n.platform.libc.length > 0;
}

/** Every lockfile entry's `resolved` URL, exactly as written, by location; the lockfile is parsed once. */
function resolvedByLocation(lockText: string): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const packages = (JSON.parse(lockText) as { packages?: unknown }).packages;
    if (typeof packages !== "object" || packages === null) return out;
    for (const [location, entry] of Object.entries(packages as Record<string, { resolved?: unknown } | null>)) {
      if (typeof entry?.resolved === "string") out.set(location, entry.resolved);
    }
  } catch {
    // an unreadable lockfile has no resolved URLs; admission refuses it before this
  }
  return out;
}

/**
 * The tarballs an admitted graph needs, from its registry nodes. This slice materializes registry packages only: a
 * workspace, local folder, link or any other source refuses (`source_not_materializable`), and so do root lifecycle
 * scripts, which `npm ci` would run in the project directory (`root_lifecycle_unsupported`).
 */
export function planFetches(graph: NpmGraph, lockText: string, registries: readonly string[]): { fetches: InstallFetch[]; reasons: InstallReason[] } {
  const reasons: InstallReason[] = [];
  const scripts = Object.keys(graph.root.lifecycleScripts ?? {}).sort();
  if (scripts.length > 0) {
    reasons.push(installReason("root_lifecycle_unsupported", "hold", "", `the root package.json has ${scripts.join(", ")}; this command never runs root lifecycle scripts`));
  }
  const fetches: InstallFetch[] = [];
  const resolvedAt = resolvedByLocation(lockText);
  for (const n of graph.nodes) {
    if (n.source.kind !== "registry" || n.version === null || n.integrity === null) {
      reasons.push(installReason("source_not_materializable", "hold", n.location, `a ${n.source.kind} source is not materialized by this command; only registry tarballs are`));
      continue;
    }
    const resolved = resolvedAt.get(n.location) ?? null;
    const problem = resolved === null ? refusal("fetch_refused", "the lockfile entry has no resolved URL") : fetchUrlProblem(resolved, registries);
    if (problem !== null || resolved === null) {
      reasons.push(installReason(problem!.code, problem!.code === "url_credentials" ? "fail" : "hold", n.location, problem!.detail));
      continue;
    }
    fetches.push({ location: n.location, name: n.name, version: n.version, resolved, integrity: n.integrity, installScript: n.installScript });
  }
  return { fetches, reasons };
}

// --- tarball ---------------------------------------------------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The install-time scripts npm would run for this tarball, including the implicit `node-gyp rebuild`. */
function tarballInstallScripts(m: Record<string, unknown>, c: TarballContents): InstallScript[] {
  const scripts = isObj(m.scripts) ? m.scripts : {};
  const has = (s: string) => typeof scripts[s] === "string" && (scripts[s] as string).trim() !== "";
  const out: InstallScript[] = INSTALL_SCRIPTS.filter(has);
  if (c.bindingGyp && m.gypfile !== false && !has("install") && !has("preinstall")) out.push("install");
  return [...new Set(out)].sort();
}

/**
 * Compare a fetched tarball with its lockfile node: the same name and version; install scripts exactly when the
 * lockfile says `hasInstallScript`; no bundled dependencies and no shrinkwrap the lockfile did not declare.
 */
export function tarballFindings(fetch: InstallFetch, node: NpmGraphNode, c: TarballContents): { reasons: InstallReason[]; installScripts: InstallScript[] } {
  const at = fetch.location;
  let m: unknown;
  try {
    m = JSON.parse(c.manifest);
  } catch {
    return { reasons: [installReason("tarball_malformed", "hold", at, "the tarball's package.json is not JSON")], installScripts: [] };
  }
  if (!isObj(m)) return { reasons: [installReason("tarball_malformed", "hold", at, "the tarball's package.json is not an object")], installScripts: [] };
  const reasons: InstallReason[] = [];
  if (m.name !== node.name || m.version !== node.version) {
    reasons.push(installReason("tarball_identity_mismatch", "hold", at, `the tarball is ${String(m.name)}@${String(m.version)}, the lockfile says ${node.name}@${String(node.version)}`));
  }
  const installScripts = tarballInstallScripts(m, c);
  if ((installScripts.length > 0) !== node.installScript) {
    const said = node.installScript ? "declares hasInstallScript" : "declares no install script";
    reasons.push(installReason("install_script_mismatch", "hold", at, `the tarball has ${installScripts.length > 0 ? installScripts.join(", ") : "no install script"}; the lockfile ${said}`));
  }
  const bundled = m.bundleDependencies ?? m.bundledDependencies;
  if (bundled === true || (Array.isArray(bundled) && bundled.length > 0) || c.nodeModules) {
    reasons.push(installReason("tarball_bundled", "hold", at, "the tarball bundles dependencies (bundleDependencies or its own node_modules) the lockfile does not describe"));
  }
  if (c.shrinkwrap) reasons.push(installReason("tarball_shrinkwrap", "hold", at, "the tarball carries an npm-shrinkwrap.json"));
  return { reasons, installScripts };
}

// --- layout ----------------------------------------------------------------------------------------------------

export interface LayoutListing {
  /** Every package folder found under `node_modules`, by location (`node_modules/a`, `node_modules/a/node_modules/b`). */
  packages: { location: string; name: string | null; version: string | null; symlink: boolean }[];
  /** Every entry of a `.bin` folder: its path and its resolved target relative to the project, or null outside it. */
  bins: { path: string; target: string | null }[];
  /** Anything else found directly in a `node_modules` folder. */
  other: string[];
}

/**
 * Hold the installed tree to the admitted graph: no package folder the graph lacks, none missing (except an optional
 * platform package npm skips), none a symlink, the same name and version, no stray entries, and every `.bin` link
 * inside a package folder of the graph.
 */
export function layoutFindings(graph: NpmGraph, listing: LayoutListing): { reasons: InstallReason[]; skipped: string[] } {
  const reasons: InstallReason[] = [];
  const nodes = new Map(graph.nodes.map((n) => [n.location, n]));
  const found = new Set<string>();
  for (const p of listing.packages) {
    found.add(p.location);
    const n = nodes.get(p.location);
    if (p.symlink) reasons.push(installReason("layout_unexpected", "hold", p.location, "a package folder is a symlink"));
    else if (!n) reasons.push(installReason("layout_unexpected", "hold", p.location, "a package folder the admitted graph does not list"));
    else if (p.name !== n.name || p.version !== n.version) {
      reasons.push(installReason("layout_mismatch", "hold", p.location, `installed ${String(p.name)}@${String(p.version)}, admitted ${n.name}@${String(n.version)}`));
    }
  }
  const skipped: string[] = [];
  for (const n of graph.nodes) {
    if (found.has(n.location)) continue;
    if (platformOptional(n)) skipped.push(n.location);
    else reasons.push(installReason("layout_missing", "hold", n.location, "an admitted package was not installed"));
  }
  for (const o of listing.other) reasons.push(installReason("layout_unexpected", "hold", o, "an entry in node_modules that is not a package folder"));
  const owner = (target: string): string | null => {
    let best: string | null = null;
    for (const loc of found) if (nodes.has(loc) && target.startsWith(`${loc}/`) && (best === null || loc.length > best.length)) best = loc;
    return best;
  };
  for (const b of listing.bins) {
    if (b.target === null || b.target.split("/").includes(".bin") || owner(b.target) === null) {
      reasons.push(installReason("bin_link_outside", "hold", b.path, `the link points to ${b.target ?? "a path outside the project"}, not into an admitted package`));
    }
  }
  return { reasons, skipped: skipped.sort() };
}

// --- bounded environment ---------------------------------------------------------------------------------------

/** What an environment that runs approved lifecycle scripts must name: a cell of the ADR-0063 capability matrix. */
export interface BoundedEnvironmentClaim {
  capabilityId: string;
}

/**
 * Why lifecycle scripts may not run in this environment. Only a cell the capability matrix records as `prevention`
 * for `dependency.materialize`, proven by a committed canary, counts; no cell is yet, so every claim is refused.
 */
export function boundedEnvironmentProblem(claim: BoundedEnvironmentClaim | null): string | null {
  if (claim === null) return "no bounded environment is configured for lifecycle scripts";
  const row = admissionCapabilityReport().rows.find((r) => r.capabilityId === claim.capabilityId);
  if (!row || !claim.capabilityId.endsWith("/dependency.materialize")) return `${claim.capabilityId} is not a dependency.materialize cell of the capability matrix`;
  if (row.level !== "prevention") return `${claim.capabilityId} is ${row.level}, not prevention: no canary proves confinement`;
  return null;
}

// --- receipt ---------------------------------------------------------------------------------------------------

export interface InstallInputs {
  /** sha256 of the base `verify.yaml` bytes. */
  verify_yaml: string;
  policy_revision: string;
  lockfile: string;
  manifest: string | null;
  /** sha256 of the canonical list of approval files (path, sha256) under `approval_refs` at base. */
  approvals: string;
  allowed_signers: string | null;
}

export interface InstallPackage {
  location: string;
  name: string;
  version: string;
  integrity: string;
  outcome: "verified" | "materialized" | "skipped" | "refused";
  install_scripts: InstallScript[];
}

export interface InstallScriptRun {
  location: string;
  scripts: InstallScript[];
  status: "refused" | "ran" | "failed";
}

/** `opengantry.dependency-install.v1`: what `gantry npm ci` did, digest-only, with no prevention claim. */
export interface DependencyInstallReceipt {
  schema: typeof DEPENDENCY_INSTALL_SCHEMA;
  outcome: "installed" | "refused";
  /** `audit` when the policy is in audit mode or a lifecycle script ran unconfined; `enforce` otherwise. */
  enforcement: "enforce" | "audit";
  /** Always false: this command does not confine package code or block other installers (#356). */
  prevention: false;
  preventive_capability: null;
  /** Always false: `npm install`, `npx`, `yarn`, `pnpm` or a child shell run directly are not intercepted. */
  direct_installers_blocked: false;
  base: string | null;
  head: string | null;
  directory: string;
  lockfile: string | null;
  inputs: InstallInputs | null;
  npm: { pinned: string; found: string | null } | null;
  admission: VerifyDependencies | null;
  packages: InstallPackage[];
  scripts: InstallScriptRun[];
  reasons: InstallReason[];
}

/** The TypeScript receipt and the zod schema, held equal at compile time. */
const sameShape: [(x: DependencyInstallReceiptSchema) => DependencyInstallReceipt, (x: DependencyInstallReceipt) => DependencyInstallReceiptSchema] = [
  (x) => x,
  (x) => x,
];
void sameShape;
