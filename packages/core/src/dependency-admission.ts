import { createHash } from "node:crypto";
import {
  DEPENDENCY_REVOCATION_SCHEMA,
  INSTALL_SCRIPTS,
  parseAllowedSigners,
  parseDependencyApproval,
  parseDependencyRevocation,
  verifyDependencyApproval,
  type DependencyApproval,
} from "./dependency-approval.js";
import type { NpmGraph, NpmGraphNode, NpmGraphResult } from "./dependency-graph.js";
import { dependencyPolicyRevision, type DependencyMode, type DependencyPolicy } from "./dependency-policy.js";

/**
 * Dependency admission (issue #355 slice 2, ADR-0062 decisions 3, 4 and 7): judge the head graph of one npm lockfile
 * against the effective policy and the approvals, all read from the base commit. Pure and deterministic: no fs, git,
 * clock or network; the caller passes `now`, the base commit's allowed-signers text and the content digests of
 * `file:` paths at base. No AI output is an input. Every package in the head graph must be admitted, by the explicit
 * baseline import or by a usable signed approval; an approval admits a package that is new against the base graph
 * only when it was made for exactly this head graph. Not wired into `gantry verify` yet (slice 3).
 */

const DEPENDENCY_ADMISSION_SCHEMA = "opengantry.dependency-admission.v1";
const MAX_APPROVAL_FILES = 1000;
const MAX_APPROVAL_FILE_BYTES = 4 * 1024 * 1024;

type AdmissionSeverity = "fail" | "hold" | "info";

const SEVERITY = {
  invalid_input: "hold",
  graph_hold: "hold",
  unsupported_lockfile: "hold",
  too_many_nodes: "hold",
  baseline_unavailable: "hold",
  baseline_mismatch: "fail",
  approvals_too_large: "hold",
  approval_invalid: "hold",
  approval_outside_refs: "hold",
  approval_signature_invalid: "fail",
  approval_inactive: "info",
  source_credentials: "fail",
  registry_not_allowed: "hold",
  integrity_missing: "hold",
  source_git: "hold",
  source_url: "hold",
  source_file: "hold",
  source_external: "hold",
  source_bundled: "hold",
  source_shrinkwrap: "hold",
  source_unresolved: "hold",
  local_outside_repository: "hold",
  link_target_missing: "hold",
  unapproved_identity: "hold",
  approval_stale: "hold",
  approval_expired: "hold",
  approval_revoked: "hold",
  lifecycle_denied: "hold",
  lifecycle_unapproved: "hold",
  root_manifest_missing: "hold",
} as const satisfies Record<string, AdmissionSeverity>;

type AdmissionCode = keyof typeof SEVERITY;

export interface AdmissionReason {
  code: AdmissionCode;
  severity: AdmissionSeverity;
  /** Graph location (`""` is the root), approval file path, or null. */
  location: string | null;
  detail: string;
}

export interface AdmissionInput {
  /** The effective policy, from the base commit (merged tighten-only). */
  policy: DependencyPolicy;
  /** Repository-relative path of the lockfile judged. */
  lockfile: string;
  /** The base commit's graph; null when the base has no such lockfile. */
  base: NpmGraphResult | null;
  head: NpmGraphResult;
  /** The graph whose digest is `approved_baseline_digest`; ignored when the policy names none. */
  baseline: NpmGraphResult | null;
  /** Files under `approval_refs`, as read from the base commit. */
  approvals: readonly { path: string; text: string }[];
  /** The base commit's allowed-signers file (`.gitagent/foreman/PLANNER.signing.pub`); null when absent. */
  allowedSigners: string | null;
  /** sha256 content digests at the base commit, by repository-relative path, for `file:` sources. */
  contentDigests: Readonly<Record<string, string>>;
  /** UTC timestamp the expiry is judged at (`2026-11-16T00:00:00Z`). */
  now: string;
}

export interface DependencyAdmission {
  schema: typeof DEPENDENCY_ADMISSION_SCHEMA;
  verdict: "pass" | "hold" | "fail";
  mode: DependencyMode;
  lockfile: string;
  policyRevision: string;
  baseGraph: string | null;
  headGraph: string | null;
  reasons: AdmissionReason[];
  /** Ids of the approvals that admitted something. */
  approvalsUsed: string[];
}

type Unusable = "approval_stale" | "approval_expired" | "approval_revoked";

interface Authority {
  approval: DependencyApproval;
  unusable: Unusable | null;
  why: string;
}

interface State {
  input: AdmissionInput;
  head: NpmGraph;
  reasons: AdmissionReason[];
  used: Set<string>;
  authorities: Authority[];
  baseline: { ids: Set<string>; scripted: Set<string>; root: Set<string> };
  base: { ids: Set<string>; scripted: Set<string>; root: Set<string> };
}

interface Identified {
  name: string;
  version: string | null;
  source: { kind: string; ref: string | null };
  integrity: string | null;
}

const idOf = (n: Identified): string => `${n.name}@${n.version ?? "?"} ${n.source.kind}:${n.source.ref ?? ""} ${n.integrity ?? "-"}`;
const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

function add(reasons: AdmissionReason[], code: AdmissionCode, location: string | null, detail: string): void {
  reasons.push({ code, severity: SEVERITY[code], location, detail });
}

function isUtc(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s) && !Number.isNaN(Date.parse(s));
}

function isLockfilePath(p: string): boolean {
  const base = p.slice(p.lastIndexOf("/") + 1);
  return (base === "package-lock.json" || base === "npm-shrinkwrap.json") && !p.startsWith("/") && p.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

/** `dir` joined with a lockfile-relative path, normalized; null when it leaves the repository. */
function repoPath(lockfile: string, rel: string): string | null {
  if (rel.startsWith("/") || rel.includes("\\")) return null;
  const out = lockfile.split("/").slice(0, -1);
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.length === 0 ? "." : out.join("/");
}

function graphSets(g: NpmGraph | null): State["base"] {
  if (!g) return { ids: new Set(), scripted: new Set(), root: new Set() };
  const scripts = g.root.lifecycleScripts ?? {};
  return {
    ids: new Set(g.nodes.map(idOf)),
    scripted: new Set(g.nodes.filter((n) => n.installScript).map(idOf)),
    root: new Set(Object.entries(scripts).map(([k, v]) => `${k} ${sha256(v)}`)),
  };
}

function finish(input: AdmissionInput, reasons: AdmissionReason[], used: Set<string>, base: string | null, head: string | null): DependencyAdmission {
  const key = (r: AdmissionReason) => `${r.location ?? ""}\u0000${r.code}\u0000${r.detail}`;
  const sorted = reasons.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  const verdict = sorted.some((r) => r.severity === "fail") ? "fail" : sorted.some((r) => r.severity === "hold") ? "hold" : "pass";
  return {
    schema: DEPENDENCY_ADMISSION_SCHEMA,
    verdict,
    mode: input.policy.mode,
    lockfile: input.lockfile,
    policyRevision: dependencyPolicyRevision(input.policy),
    baseGraph: base,
    headGraph: head,
    reasons: sorted,
    approvalsUsed: [...used].sort(),
  };
}

// --- authority ------------------------------------------------------------------------------------------------

function schemaOf(text: string): unknown {
  try {
    const v = JSON.parse(text) as unknown;
    return typeof v === "object" && v !== null ? (v as { schema?: unknown }).schema : undefined;
  } catch {
    return undefined;
  }
}

function readAuthority(input: AdmissionInput, reasons: AdmissionReason[]): Authority[] {
  if (input.approvals.length > MAX_APPROVAL_FILES || input.approvals.some((f) => f.text.length > MAX_APPROVAL_FILE_BYTES)) {
    add(reasons, "approvals_too_large", null, `more than ${String(MAX_APPROVAL_FILES)} approval files, or one larger than ${String(MAX_APPROVAL_FILE_BYTES)} bytes`);
    return [];
  }
  const signers = parseAllowedSigners(input.allowedSigners ?? "");
  const approvals: DependencyApproval[] = [];
  const revoked = new Set<string>();
  for (const file of [...input.approvals].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const clean = !file.path.startsWith("/") && file.path.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
    if (!clean || !input.policy.approvalRefs.some((ref) => file.path.startsWith(ref))) {
      add(reasons, "approval_outside_refs", file.path, "not under the policy's approval_refs; not authority");
      continue;
    }
    const revocation = schemaOf(file.text) === DEPENDENCY_REVOCATION_SCHEMA;
    let approval: DependencyApproval;
    try {
      if (revocation) {
        parseDependencyRevocation(file.text).revokes.forEach((id) => revoked.add(id));
        continue;
      }
      approval = parseDependencyApproval(file.text);
    } catch (err) {
      add(reasons, "approval_invalid", file.path, (err as Error).message);
      continue;
    }
    const v = verifyDependencyApproval(approval, signers);
    if (v.status === "bad") add(reasons, "approval_signature_invalid", file.path, v.detail);
    else approvals.push(approval);
  }
  return approvals.filter((a) => a.lockfile === input.lockfile).map((a) => classify(a, input, revoked));
}

function classify(approval: DependencyApproval, input: AdmissionInput, revoked: Set<string>): Authority {
  if (revoked.has(approval.id)) return { approval, unusable: "approval_revoked", why: `approval ${approval.id.slice(0, 12)} is revoked` };
  if (input.now >= approval.expiresAt || input.now < approval.issuedAt) {
    return { approval, unusable: "approval_expired", why: `approval ${approval.id.slice(0, 12)} is valid ${approval.issuedAt} to ${approval.expiresAt}` };
  }
  if (approval.policyRevision !== dependencyPolicyRevision(input.policy)) {
    return { approval, unusable: "approval_stale", why: `approval ${approval.id.slice(0, 12)} was made for another policy revision` };
  }
  return { approval, unusable: null, why: "" };
}

/**
 * Whether a usable approval matching `matches` admits this; a new item (not in the base graph) needs an approval
 * made for exactly the head graph. Otherwise the most telling reason code.
 */
function authorize(s: State, fresh: boolean, matches: (a: DependencyApproval) => boolean): { ok: true } | { ok: false; code: AdmissionCode | null; why: string } {
  let miss: { code: AdmissionCode | null; why: string } = { code: null, why: "" };
  for (const auth of s.authorities.filter((x) => matches(x.approval))) {
    if (auth.unusable) miss = { code: auth.unusable, why: auth.why };
    else if (fresh && auth.approval.graphDigest !== s.head.digest) {
      miss = { code: "approval_stale", why: `approval ${auth.approval.id.slice(0, 12)} was made for graph ${auth.approval.graphDigest.slice(0, 12)}` };
    } else {
      s.used.add(auth.approval.id);
      return { ok: true };
    }
  }
  return { ok: false, ...miss };
}

// --- nodes ----------------------------------------------------------------------------------------------------

function sameNode(a: Identified, n: NpmGraphNode): boolean {
  return idOf(a) === idOf(n);
}

function judgeIdentity(s: State, n: NpmGraphNode): void {
  const id = idOf(n);
  if (s.baseline.ids.has(id)) return;
  const r = authorize(s, !s.base.ids.has(id), (a) => a.identities.some((x) => sameNode(x, n)));
  if (!r.ok) add(s.reasons, r.code ?? "unapproved_identity", n.location, r.code ? `${id}: ${r.why}` : `${id} is not in the baseline or any approval`);
}

function judgeFile(s: State, n: NpmGraphNode, rel: string): boolean {
  const path = repoPath(s.input.lockfile, rel);
  if (path === null) {
    add(s.reasons, "local_outside_repository", n.location, `${rel} resolves outside the repository`);
    return false;
  }
  const digest = s.input.contentDigests[path];
  const r = authorize(s, !s.base.ids.has(idOf(n)), (a) => digest !== undefined && a.files.some((f) => f.path === path && f.contentDigest === digest));
  if (!r.ok) add(s.reasons, r.code ?? "source_file", n.location, r.code ? `${path}: ${r.why}` : `${path} is not approved with its content digest at base`);
  return r.ok;
}

function judgeRegistry(s: State, n: NpmGraphNode): void {
  if (!s.input.policy.registries.includes(n.source.ref ?? "")) add(s.reasons, "registry_not_allowed", n.location, `${n.source.ref ?? "?"} is not an allowed registry`);
  else if (n.integrity === null) add(s.reasons, "integrity_missing", n.location, `${n.name}@${n.version ?? "?"} has no integrity`);
  else judgeIdentity(s, n);
}

const HOLD_KIND: Partial<Record<NpmGraphNode["source"]["kind"], AdmissionCode>> = {
  git: "source_git",
  url: "source_url",
  bundled: "source_bundled",
  unresolved: "source_unresolved",
};

/** Source and identity of one node; returns the admitted local folders as it goes. */
function judgeSource(s: State, n: NpmGraphNode, admittedLocal: Set<string>): void {
  const { kind, ref } = n.source;
  const hold = HOLD_KIND[kind];
  if (n.source.credentials) add(s.reasons, "source_credentials", n.location, "the source URL carries credentials");
  else if (hold) add(s.reasons, hold, n.location, `${kind} sources hold by default`);
  else if (n.flags.includes("hasShrinkwrap")) add(s.reasons, "source_shrinkwrap", n.location, "a package with its own shrinkwrap holds by default");
  else if (kind === "registry") judgeRegistry(s, n);
  else if (kind === "local") {
    if (judgeFile(s, n, n.location)) admittedLocal.add(n.location);
  } else if (kind === "file") judgeFile(s, n, (ref ?? "").replace(/^file:/, ""));
  else if (kind === "link" && !s.head.nodes.some((x) => x.location === ref)) add(s.reasons, "link_target_missing", n.location, `link target ${ref ?? "?"} is not in the lockfile`);
}

function judgeExternal(s: State, n: NpmGraphNode, admittedLocal: Set<string>): void {
  const owner = n.location.slice(0, n.location.indexOf("/node_modules/"));
  if (n.source.credentials) add(s.reasons, "source_credentials", n.location, "the source URL carries credentials");
  else if (!admittedLocal.has(owner)) add(s.reasons, "source_external", n.location, `belongs to the local folder ${owner}, which is not admitted`);
}

function judgeNodeScript(s: State, n: NpmGraphNode): void {
  if (!n.installScript) return;
  if (s.input.policy.lifecycle === "deny") {
    add(s.reasons, "lifecycle_denied", n.location, `${n.name} has an install script; the policy denies lifecycle scripts`);
    return;
  }
  const id = idOf(n);
  if (s.baseline.scripted.has(id)) return;
  const all = [...INSTALL_SCRIPTS].sort().join(",");
  const r = authorize(s, !s.base.scripted.has(id), (a) => a.lifecycle.some((l) => sameNode(l, n) && l.scripts.join(",") === all));
  if (!r.ok) add(s.reasons, "lifecycle_unapproved", n.location, `${id} has an install script that no usable approval permits (${all})${r.code ? `; ${r.why}` : ""}`);
}

function judgeRootScripts(s: State): void {
  const scripts = s.head.root.lifecycleScripts;
  if (scripts === null) {
    add(s.reasons, "root_manifest_missing", "", "the root package.json was not read; its lifecycle scripts are unknown");
    return;
  }
  for (const [name, command] of Object.entries(scripts).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (s.input.policy.lifecycle === "deny") {
      add(s.reasons, "lifecycle_denied", "", `root script ${name}; the policy denies lifecycle scripts`);
      continue;
    }
    const key = `${name} ${sha256(command)}`;
    if (s.baseline.root.has(key)) continue;
    const r = authorize(s, !s.base.root.has(key), (a) => a.rootScripts.some((x) => `${x.script} ${x.commandSha256}` === key));
    if (!r.ok) add(s.reasons, "lifecycle_unapproved", "", `root script ${name} (command sha256 ${sha256(command).slice(0, 12)}) is not permitted${r.code ? `; ${r.why}` : ""}`);
  }
}

// --- entry point ----------------------------------------------------------------------------------------------

function graphOrHold(r: NpmGraphResult | null, which: string, reasons: AdmissionReason[]): NpmGraph | null {
  if (r === null || r.status === "ok") return r?.graph ?? null;
  add(reasons, "graph_hold", r.location, `${which} graph: ${r.code}: ${r.detail}`);
  return null;
}

function baselineOf(input: AdmissionInput, reasons: AdmissionReason[]): NpmGraph | null {
  const want = input.policy.approvedBaselineDigest;
  if (want === null) return null;
  const b = input.baseline;
  if (b === null || b.status !== "ok") {
    add(reasons, "baseline_unavailable", null, `the baseline graph ${want.slice(0, 12)} was not supplied or does not parse`);
    return null;
  }
  if (b.graph.digest !== want) {
    add(reasons, "baseline_mismatch", null, `the supplied baseline graph is ${b.graph.digest.slice(0, 12)}, not ${want.slice(0, 12)}`);
    return null;
  }
  return b.graph;
}

function shapeHolds(input: AdmissionInput, head: NpmGraph, reasons: AdmissionReason[]): void {
  if (!input.policy.npm.lockfileVersions.includes(head.lockfileVersion)) {
    add(reasons, "unsupported_lockfile", null, `lockfileVersion ${String(head.lockfileVersion)} is not in the policy's lockfile_versions`);
  }
  if (head.nodes.length > input.policy.limits.maxNodes) add(reasons, "too_many_nodes", null, `more than ${String(input.policy.limits.maxNodes)} nodes`);
}

/** Judge one lockfile's head graph: pass, hold or fail, with stable reason codes. */
export function evaluateDependencyAdmission(input: AdmissionInput): DependencyAdmission {
  const reasons: AdmissionReason[] = [];
  const used = new Set<string>();
  if (!isUtc(input.now) || !isLockfilePath(input.lockfile)) {
    add(reasons, "invalid_input", null, "now must be a UTC timestamp and lockfile a repository-relative package-lock.json or npm-shrinkwrap.json");
    return finish(input, reasons, used, null, null);
  }
  const baseGraph = graphOrHold(input.base, "base", reasons);
  const head = graphOrHold(input.head, "head", reasons);
  if (!head || (input.base !== null && !baseGraph)) return finish(input, reasons, used, baseGraph?.digest ?? null, head?.digest ?? null);
  shapeHolds(input, head, reasons);
  const s: State = {
    input,
    head,
    reasons,
    used,
    authorities: readAuthority(input, reasons),
    baseline: graphSets(baselineOf(input, reasons)),
    base: graphSets(baseGraph),
  };
  const admittedLocal = new Set<string>();
  const external = head.nodes.filter((n) => n.source.kind === "external");
  for (const n of head.nodes) if (n.source.kind !== "external") judgeSource(s, n, admittedLocal);
  for (const n of external) judgeExternal(s, n, admittedLocal);
  for (const n of head.nodes) judgeNodeScript(s, n);
  judgeRootScripts(s);
  for (const a of s.authorities) {
    if (!used.has(a.approval.id) && a.unusable) add(reasons, "approval_inactive", null, a.why);
  }
  return finish(input, reasons, used, baseGraph?.digest ?? null, head.digest);
}
