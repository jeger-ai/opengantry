import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { canonicalJson } from "#core/canonical-json.js";
import { evaluateDependencyAdmission } from "#core/dependency-admission.js";
import { diffNpmGraphs, parseNpmLockfile, type NpmGraph, type NpmGraphLimits, type NpmGraphResult } from "#core/dependency-graph.js";
import { dependencyPolicyRevision, type DependencyPolicy } from "#core/dependency-policy.js";
import { verifyDependenciesProblem as schemaProblem, type VerifyDependencies as SchemaDependencies } from "#core/schemas/verify-dependencies-schema.js";
import { gitChildEnv, gitRun } from "#git/git.js";
import { diskSourceTree, gitSourceTree, type SourceTree } from "./imports.js";

/**
 * Dependency admission in `gantry verify --contract` (issue #355 slice 3, ADR-0062 decisions 5-7). Every authority
 * input is a git object at the base commit: the approvals under `approval_refs`, the allowed signers, the base graph,
 * the baseline graph and the content digests of `file:` folders. Only the head lockfiles and manifests come from the
 * change. The verdict is the pure slice-2 evaluator's, per changed lockfile, plus the checks around it: unsupported
 * lockfiles, `node_modules` and a manifest that changed without its lockfile hold. It runs after the change was made,
 * so it is labelled `enforcement: audit` whatever the mode: it can fail a merge, not prevent code that already ran.
 */

export const VERIFY_DEPENDENCIES_SCHEMA = "opengantry.verify-dependencies.v1" as const;

type Severity = "fail" | "hold" | "info";
type Outcome = "pass" | "hold" | "fail";

interface Reason {
  code: string;
  severity: Severity;
  /** The dependency file the reason is about. */
  file: string;
  /** Graph location (`""` is the root), approval file, or null. */
  location: string | null;
  detail: string;
}

interface Lockfile {
  path: string;
  outcome: Outcome;
  base_graph: string | null;
  head_graph: string | null;
  /** sha256 of the canonical base-to-head graph diff; null without both graphs. */
  graph_diff: string | null;
  approvals_used: string[];
}

/**
 * The `dependencies` section of an `opengantry.verify-result.v2` result. Plain TypeScript, so the slim package's
 * declarations need no zod; `packages/core/src/schemas/verify-dependencies-schema.ts` is the schema, and the two are
 * held equal at compile time below.
 */
export interface VerifyDependencies {
  schema: typeof VERIFY_DEPENDENCIES_SCHEMA;
  outcome: Outcome;
  mode: "audit" | "enforce";
  /** Always `audit`: a post-change check cannot prevent code that already ran (ADR-0062 decision 5). */
  enforcement: "audit";
  base: string;
  head: string;
  policy_revision: string;
  ecosystems: "npm"[];
  files: string[];
  lockfiles: Lockfile[];
  approvals_used: string[];
  reasons: Reason[];
}

const sameShape: [(x: SchemaDependencies) => VerifyDependencies, (x: VerifyDependencies) => SchemaDependencies] = [(x) => x, (x) => x];
void sameShape;

/** Why a value is not a valid `opengantry.verify-dependencies.v1` section (the strict zod schema), or null. */
export function verifyDependenciesProblem(value: unknown): string | null {
  return schemaProblem(value);
}

const ALLOWED_SIGNERS = ".gitagent/foreman/PLANNER.signing.pub";
const LOCKFILES = ["npm-shrinkwrap.json", "package-lock.json"];
const UNSUPPORTED = ["yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb"];
const EDGE_KINDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
/** How far back the base history is searched for the graph `approved_baseline_digest` names. */
const BASELINE_HISTORY = 50;
/** One more than the evaluator accepts, so it reports `approvals_too_large` instead of judging a truncated list. */
const MAX_APPROVAL_LIST = 1001;
const CONTENT_MAX_FILES = 10_000;
const CONTENT_MAX_BYTES = 64 * 1024 * 1024;
const DETAIL_MAX = 300;

interface DependencyJudgeInput {
  root: string;
  base: string;
  head: string;
  /** Read the head files from the working tree instead of the head commit. */
  worktree: boolean;
  /** Changed paths since the base, as the rest of the run judges them. */
  changed: readonly string[];
  /** The effective policy: the base `verify.yaml` section, merged tighten-only. */
  policy: DependencyPolicy;
  /** UTC timestamp approvals are judged at. */
  now: string;
}

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const nameOf = (p: string): string => p.slice(p.lastIndexOf("/") + 1);
const dirOf = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const join = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);
const RANK: Record<Severity, number> = { info: 0, hold: 1, fail: 2 };

function outcomeOf(reasons: readonly Reason[]): VerifyDependencies["outcome"] {
  const worst = Math.max(0, ...reasons.map((r) => RANK[r.severity]));
  return worst === 2 ? "fail" : worst === 1 ? "hold" : "pass";
}

function reason(code: string, severity: Severity, file: string, location: string | null, detail: string): Reason {
  return { code, severity, file, location, detail: detail.length > DETAIL_MAX ? `${detail.slice(0, DETAIL_MAX)}…` : detail };
}

function isDependencyFile(p: string): boolean {
  return p.split("/").includes("node_modules") || ["package.json", ...LOCKFILES, ...UNSUPPORTED].includes(nameOf(p));
}

/** A lockfile-relative path inside the repository, normalized as the evaluator does; null when it leaves the repository. */
function repoPath(lockfile: string, rel: string): string | null {
  if (rel.startsWith("/") || rel.includes("\\")) return null;
  const out = dirOf(lockfile).split("/").filter(Boolean);
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.length === 0 ? "." : out.join("/");
}

function readBlob(root: string, rev: string, rel: string): string | null {
  const r = gitRun(root, ["cat-file", "blob", `${rev}:${rel}`], 512 * 1024 * 1024);
  return r.ok ? r.stdout : null;
}

function graphOf(lock: string | null, manifest: string | null, limits: NpmGraphLimits): NpmGraphResult | null {
  if (lock === null) return null;
  return parseNpmLockfile(lock, { ...(manifest === null ? {} : { manifest }), limits });
}

/**
 * `opengantry.content-digest.v1` of a path at a commit: sha256 of the canonical JSON of every blob under it (its path
 * relative to the given path, `""` for the path itself, its git mode and the sha256 of its bytes), sorted by path.
 * Null when the path is absent, holds a submodule, or exceeds 10,000 files or 64 MiB; an approval cannot match then.
 */
export function contentDigestAt(root: string, rev: string, rel: string): string | null {
  const listed = gitRun(root, ["ls-tree", "-r", "-z", "--full-tree", rev, ...(rel === "." ? [] : ["--", rel])]);
  if (!listed.ok) return null;
  const entries = listed.stdout.split("\0").filter(Boolean).map((line) => {
    const [meta, path] = [line.slice(0, line.indexOf("\t")), line.slice(line.indexOf("\t") + 1)];
    const [mode, type, oid] = meta.split(" ");
    return { mode: mode!, type: type!, oid: oid!, rel: rel === "." ? path : path === rel ? "" : path.slice(rel.length + 1) };
  });
  if (entries.length === 0 || entries.length > CONTENT_MAX_FILES || entries.some((e) => e.type !== "blob")) return null;
  const r = spawnSync("git", ["-C", root, "cat-file", "--batch"], {
    input: `${entries.map((e) => e.oid).join("\n")}\n`,
    maxBuffer: CONTENT_MAX_BYTES + entries.length * 128,
    env: gitChildEnv(),
  });
  if (r.status !== 0 || !Buffer.isBuffer(r.stdout)) return null;
  const out = r.stdout;
  const sums: string[] = [];
  let at = 0;
  for (let i = 0; i < entries.length; i++) {
    const eol = out.indexOf(10, at);
    const size = Number(out.subarray(at, eol).toString("utf8").split(" ")[2]);
    if (eol < 0 || !Number.isSafeInteger(size)) return null;
    sums.push(sha256(out.subarray(eol + 1, eol + 1 + size)));
    at = eol + 1 + size + 1;
  }
  const rows = entries.map((e, i) => [e.rel, e.mode, sums[i]!]).sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0));
  return sha256(canonicalJson({ schema: "opengantry.content-digest.v1", entries: rows }));
}

interface Ctx {
  input: DependencyJudgeInput;
  baseTree: SourceTree;
  headTree: SourceTree;
  approvals: { path: string; text: string }[];
  allowedSigners: string | null;
  reasons: Reason[];
}

/** Files under the policy's `approval_refs` at the base commit. */
function approvalsAt(input: DependencyJudgeInput, baseTree: SourceTree): { path: string; text: string }[] {
  const r = gitRun(input.root, ["ls-tree", "-r", "-z", "--name-only", "--full-tree", input.base, "--", ...input.policy.approvalRefs]);
  if (!r.ok) return [];
  return r.stdout.split("\0").filter(Boolean).slice(0, MAX_APPROVAL_LIST).map((p) => ({ path: p, text: baseTree.read(p) ?? "" }));
}

/** The graph `approved_baseline_digest` names: the base graph, else this lockfile's history behind the base. */
function baselineGraph(ctx: Ctx, lock: string, base: NpmGraphResult | null): NpmGraphResult | null {
  const want = ctx.input.policy.approvedBaselineDigest;
  if (want === null) return null;
  if (base?.status === "ok" && base.graph.digest === want) return base;
  const { root, base: rev, policy } = ctx.input;
  const log = gitRun(root, ["log", `-n${String(BASELINE_HISTORY)}`, "--format=%H", rev, "--", lock]);
  for (const commit of log.ok ? log.stdout.split("\n").filter(Boolean) : []) {
    const g = graphOf(readBlob(root, commit, lock), readBlob(root, commit, join(dirOf(lock), "package.json")), policy.limits);
    if (g?.status === "ok" && g.graph.digest === want) return g;
  }
  return null;
}

function contentDigests(ctx: Ctx, lock: string, head: NpmGraphResult): Record<string, string> {
  const out: Record<string, string> = {};
  if (head.status !== "ok") return out;
  for (const n of head.graph.nodes) {
    const rel = n.source.kind === "file" ? (n.source.ref ?? "").replace(/^file:/, "") : n.source.kind === "local" || n.source.kind === "workspace" ? n.location : null;
    const path = rel === null ? null : repoPath(lock, rel);
    if (path === null || path in out) continue;
    // The digest describes the folder at base; when the change edits the folder, npm installs other content: no digest.
    if (ctx.input.changed.some((c) => path === "." || c === path || c.startsWith(`${path}/`))) continue;
    const digest = contentDigestAt(ctx.input.root, ctx.input.base, path);
    if (digest !== null) out[path] = digest;
  }
  return out;
}

function sortedObj(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : {};
}

/** Root dependency edges and workspaces of the head manifest against the lockfile's root entry (slice 1 reads no more). */
function manifestAgreement(ctx: Ctx, lock: string, graph: NpmGraph): void {
  const file = join(dirOf(lock), "package.json");
  const text = ctx.headTree.read(file);
  if (text === null) return; // the evaluator holds root_manifest_missing
  let m: Record<string, unknown>;
  try {
    m = sortedObj(JSON.parse(text));
  } catch {
    return; // parsed with the lockfile: a malformed manifest is already a graph hold
  }
  const differ = EDGE_KINDS.filter((k) => canonicalJson(sortedObj(m[k])) !== canonicalJson(sortedObj(graph.root.edges[k])));
  const ws = Array.isArray(m.workspaces) ? m.workspaces : sortedObj(m.workspaces).packages;
  const wanted = Array.isArray(ws) ? [...(ws as unknown[])].map(String).sort() : [];
  if (canonicalJson(wanted) !== canonicalJson([...graph.root.workspaces].sort())) differ.push("workspaces");
  if (differ.length > 0) ctx.reasons.push(reason("manifest_lock_mismatch", "hold", file, "", `${differ.join(", ")} in ${file} differ from the root of ${lock}`));
}

function judgeLockfile(ctx: Ctx, lock: string): Lockfile {
  const { input, baseTree, headTree } = ctx;
  const empty = { path: lock, base_graph: null, head_graph: null, graph_diff: null, approvals_used: [] };
  const headText = headTree.read(lock);
  if (headText === null) {
    const remains = headTree.has(join(dirOf(lock), "package.json"));
    const r = remains
      ? reason("lockfile_missing", "hold", lock, null, `${lock} was removed but its package.json remains: npm would resolve without a lockfile`)
      : reason("lockfile_removed", "info", lock, null, `${lock} was removed with its package.json`);
    ctx.reasons.push(r);
    return { ...empty, outcome: outcomeOf([r]) };
  }
  const manifestAt = (tree: SourceTree) => tree.read(join(dirOf(lock), "package.json"));
  const head = graphOf(headText, manifestAt(headTree), input.policy.limits)!;
  const base = graphOf(baseTree.read(lock), manifestAt(baseTree), input.policy.limits);
  const admission = evaluateDependencyAdmission({
    policy: input.policy,
    lockfile: lock,
    base,
    head,
    headLockfileBytes: Buffer.byteLength(headText, "utf8"),
    baseline: baselineGraph(ctx, lock, base),
    approvals: ctx.approvals,
    allowedSigners: ctx.allowedSigners,
    contentDigests: contentDigests(ctx, lock, head),
    now: input.now,
  });
  const before = ctx.reasons.length;
  ctx.reasons.push(...admission.reasons.map((r) => reason(r.code, r.severity, lock, r.location, r.detail)));
  if (head.status === "ok") manifestAgreement(ctx, lock, head.graph);
  const diff = base?.status === "ok" && head.status === "ok" ? sha256(canonicalJson(diffNpmGraphs(base.graph, head.graph))) : null;
  return {
    path: lock,
    outcome: outcomeOf(ctx.reasons.slice(before)),
    base_graph: admission.baseGraph,
    head_graph: admission.headGraph,
    graph_diff: diff,
    approvals_used: admission.approvalsUsed,
  };
}

/** The lockfile npm uses for a manifest: the nearest directory at or above it with one (npm-shrinkwrap.json first). */
function governingLockfile(tree: SourceTree, manifest: string): string | null {
  for (let dir = dirOf(manifest); ; dir = dirOf(dir)) {
    const found = LOCKFILES.map((l) => join(dir, l)).find((l) => tree.has(l));
    if (found) return found;
    if (dir === "") return null;
  }
}

function judgeManifest(ctx: Ctx, file: string): void {
  const present = ctx.headTree.has(file);
  // A manifest that remains is installed with the head's lockfile; a removed one was governed by the base's.
  const lock = governingLockfile(present ? ctx.headTree : ctx.baseTree, file);
  if (lock === null) {
    if (present) ctx.reasons.push(reason("manifest_without_lockfile", "hold", file, null, `${file} has no npm lockfile at or above it: npm would resolve without one`));
    return;
  }
  if (!ctx.input.changed.includes(lock)) {
    ctx.reasons.push(reason("manifest_without_lock_change", "hold", file, null, `${file} changed but ${lock} did not`));
  }
}

/** Judge every changed dependency file of the change against the effective policy. */
export function judgeDependencies(input: DependencyJudgeInput): VerifyDependencies {
  const baseTree = gitSourceTree(input.root, input.base);
  const ctx: Ctx = {
    input,
    baseTree,
    headTree: input.worktree ? diskSourceTree(input.root) : gitSourceTree(input.root, input.head),
    approvals: approvalsAt(input, baseTree),
    allowedSigners: baseTree.read(ALLOWED_SIGNERS),
    reasons: [],
  };
  const files = input.changed.filter(isDependencyFile);
  const locks: string[] = [];
  for (const f of files) {
    if (f.split("/").includes("node_modules")) {
      ctx.reasons.push(reason("node_modules_changed", "hold", f, null, "committed node_modules content bypasses the lockfile"));
    } else if (UNSUPPORTED.includes(nameOf(f))) {
      ctx.reasons.push(reason("unsupported_dependency_file", "hold", f, null, `${nameOf(f)} is not supported (npm package-lock.json or npm-shrinkwrap.json, lockfileVersion 2 or 3)`));
    } else if (LOCKFILES.includes(nameOf(f))) locks.push(f);
    else judgeManifest(ctx, f);
  }
  const lockfiles = locks.map((l) => judgeLockfile(ctx, l));
  const key = (r: Reason) => `${r.file}\u0000${r.location ?? ""}\u0000${r.code}\u0000${r.detail}`;
  const reasons = ctx.reasons.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return {
    schema: VERIFY_DEPENDENCIES_SCHEMA,
    outcome: outcomeOf(reasons),
    mode: input.policy.mode,
    enforcement: "audit",
    base: input.base,
    head: input.head,
    policy_revision: dependencyPolicyRevision(input.policy),
    ecosystems: ["npm"],
    files,
    lockfiles,
    approvals_used: [...new Set(lockfiles.flatMap((l) => l.approvals_used))].sort(),
    reasons,
  };
}
