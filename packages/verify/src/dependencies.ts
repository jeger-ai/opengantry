import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { canonicalJson } from "#core/canonical-json.js";
import { evaluateDependencyAdmission } from "#core/dependency-admission.js";
import { diffNpmGraphs, parseNpmLockfile, type NpmGraph, type NpmGraphLimits, type NpmGraphResult } from "#core/dependency-graph.js";
import { dependencyPolicyRevision, type DependencyPolicy } from "#core/dependency-policy.js";
import { globToRegExp } from "#core/path-glob.js";
import { GantryUserError } from "#core/user-error.js";
import { verifyDependenciesProblem as schemaProblem, type VerifyDependencies as SchemaDependencies } from "#core/schemas/verify-dependencies-schema.js";
import { gitChildEnv, gitRun } from "#git/git.js";
import { diskSourceTree, gitSourceTree, type SourceTree } from "./imports.js";

/**
 * Dependency admission in `gantry verify --contract` (issue #355 slice 3, ADR-0062 decisions 5-7). Every authority
 * input is a git object at the base commit: the approvals under `approval_refs`, the allowed signers, the base graph,
 * the baseline graph and the content digests of `file:` folders. Only the head lockfiles and manifests come from the
 * change. The verdict is the pure slice-2 evaluator's, per changed lockfile, plus the checks around it: unsupported
 * lockfiles, `node_modules`, a changed `.npmrc` and a manifest that changed without its lockfile hold, and a lockfile
 * whose `file:` folder the change edited (or that holds a symlink), or whose head graph does not parse, is judged although
 * the lockfile did not change. A dependency file that is a symlink holds: its target can change unseen. A tree listing
 * that fails (or outgrows its buffer) is an error, never an empty list: an empty list would judge nothing. It runs after
 * the change was made, so it is labelled `enforcement: audit` whatever the mode: it can fail a merge, not prevent code
 * that already ran.
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
/** npm configuration: the candidate's is data, never authority (registry, scripts and auth settings), so any change holds. */
const NPM_CONFIG = ".npmrc";
/** Every name judged, compared case-insensitively: npm reads `PACKAGE-LOCK.JSON` on a case-insensitive checkout. */
const DEPENDENCY_NAMES = ["package.json", ...LOCKFILES, ...UNSUPPORTED, NPM_CONFIG];
const EDGE_KINDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
/** How far back the base history is searched for the graph `approved_baseline_digest` names. */
const BASELINE_HISTORY = 50;
/** One more than the evaluator accepts, so it reports `approvals_too_large` instead of judging a truncated list. */
const MAX_APPROVAL_LIST = 1001;
const CONTENT_MAX_FILES = 10_000;
const CONTENT_MAX_BYTES = 64 * 1024 * 1024;
/** git's mode for a symbolic link: its blob is the link text, not the content npm reads through it. */
const SYMLINK_MODE = "120000";
/** git's mode for a submodule (gitlink): its content is another repository's commit, outside this one's objects. */
const GITLINK_MODE = "160000";
/** Buffer for a whole-tree listing, as `gitSourceTree` uses: a larger tree is an error, never a shorter list. */
const LIST_MAX_BYTES = 512 * 1024 * 1024;
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
  /** Test seam: the buffer for whole-tree listings (default 512 MiB). */
  listMaxBytes?: number;
  /**
   * Lockfiles judged even when the change did not touch them (`gantry npm ci`, issue #355 slice 4): an install needs
   * the whole graph admitted, not only a changed one. Every other check stays as for the changed files.
   */
  judge?: readonly string[];
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

const inNodeModules = (p: string): boolean => p.split("/").some((seg) => seg.toLowerCase() === "node_modules");

function isDependencyFile(p: string): boolean {
  return inNodeModules(p) || DEPENDENCY_NAMES.includes(nameOf(p).toLowerCase());
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
 * Null when the path is absent, holds a submodule or a symlink (its blob is the link text, not what npm reads through
 * it), or exceeds 10,000 files or 64 MiB; an approval cannot match then.
 */
export function contentDigestAt(root: string, rev: string, rel: string): string | null {
  const listed = gitRun(root, ["ls-tree", "-r", "-z", "--full-tree", rev, ...(rel === "." ? [] : ["--", rel])]);
  if (!listed.ok) return null;
  const entries = listed.stdout.split("\0").filter(Boolean).map((line) => {
    const [meta, path] = [line.slice(0, line.indexOf("\t")), line.slice(line.indexOf("\t") + 1)];
    const [mode, type, oid] = meta.split(" ");
    return { mode: mode!, type: type!, oid: oid!, rel: rel === "." ? path : path === rel ? "" : path.slice(rel.length + 1) };
  });
  if (entries.length === 0 || entries.length > CONTENT_MAX_FILES || entries.some((e) => e.type !== "blob" || e.mode === SYMLINK_MODE)) return null;
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
  /** Symlinks at base and at head (the working tree in worktree mode). */
  links: Set<string>;
  /** Submodules (gitlinks) at base and at head: a bump changes only the gitlink's own path. */
  gitlinks: Set<string>;
  /** Every path at head (the working tree in worktree mode). */
  headPaths: string[];
  reasons: Reason[];
}

interface TreeListing {
  paths: string[];
  links: string[];
  gitlinks: string[];
}

/**
 * NUL-separated git output; a failure or an output over the buffer throws (fail closed), never an empty or short
 * list. Not `gitRun`: when git exits before the buffer overflows is noticed, spawnSync reports status 0 with the
 * output cut short and only `error` (ENOBUFS) says so.
 */
function gitList(input: DependencyJudgeInput, args: string[]): string[] {
  const max = input.listMaxBytes ?? LIST_MAX_BYTES;
  const r = spawnSync("git", ["-C", input.root, ...args], { encoding: "utf8", maxBuffer: max, env: gitChildEnv() });
  if (r.error !== undefined || r.status !== 0 || typeof r.stdout !== "string") {
    const why = r.error?.message ?? (r.stderr.trim().split("\n")[0] || `exit ${String(r.status)}`);
    throw new GantryUserError("GXT_VERIFY_GIT_FAILED", `verify: git ${args.join(" ")} failed: ${why}`, undefined, 2);
  }
  return r.stdout.split("\0").filter(Boolean);
}

/** Every path, symlink and submodule at a commit, or (`rev` null) in the working tree, in one listing. */
function treeAt(input: DependencyJudgeInput, rev: string | null): TreeListing {
  if (rev !== null) {
    const rows = gitList(input, ["ls-tree", "-r", "-z", "--full-tree", rev]).map((l) => ({ mode: l.slice(0, l.indexOf(" ")), path: l.slice(l.indexOf("\t") + 1) }));
    const withMode = (mode: string) => rows.filter((r) => r.mode === mode).map((r) => r.path);
    return { paths: rows.map((r) => r.path), links: withMode(SYMLINK_MODE), gitlinks: withMode(GITLINK_MODE) };
  }
  // A staged submodule has mode 160000 in the index; an untracked nested repository is listed with a trailing slash.
  const staged = gitList(input, ["ls-files", "-z", "--stage"]).filter((l) => l.startsWith(`${GITLINK_MODE} `)).map((l) => l.slice(l.indexOf("\t") + 1));
  const listed = gitList(input, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  const nested = listed.filter((p) => p.endsWith("/")).map((p) => p.slice(0, -1));
  const gitlinks = new Set([...staged, ...nested]);
  const paths = listed.filter((p) => !p.endsWith("/"));
  const links = paths.filter((p) => {
    if (gitlinks.has(p)) return false;
    try {
      return fs.lstatSync(`${input.root}/${p}`).isSymbolicLink();
    } catch {
      return false;
    }
  });
  return { paths: [...paths, ...nested], links, gitlinks: [...gitlinks] };
}

/** Whether a folder is, is inside, or contains one of `paths` (symlinks or submodules); the root contains any. */
const linked = (paths: ReadonlySet<string>, folder: string): boolean =>
  [...paths].some((l) => folder === "." || l === folder || l.startsWith(`${folder}/`) || folder.startsWith(`${l}/`));

/**
 * Whether what npm installs from a folder is not what git holds there: the folder is, lies under or contains a symlink
 * (the target can change unseen) or a submodule (its content is another repository's commit). It has no digest.
 */
const opaque = (ctx: Ctx, folder: string): boolean => linked(ctx.links, folder) || linked(ctx.gitlinks, folder);

/**
 * Every dependency file (lockfile, `package.json`, `.npmrc`, any name case) outside `node_modules` that is a symlink at
 * base or head holds: what npm reads is the target, which can change while the link, the only path the change names,
 * does not. Judged over the whole tree, not only the changed files, since the target's path is what changes.
 */
function symlinkedDependencyFiles(ctx: Ctx): void {
  for (const p of [...ctx.links].sort()) {
    if (inNodeModules(p) || !DEPENDENCY_NAMES.includes(nameOf(p).toLowerCase())) continue;
    ctx.reasons.push(reason("dependency_file_symlink", "hold", p, null, `${p} is a symlink: npm reads its target, which can change without ${p} changing; commit the file itself`));
  }
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

/** The repository path of a `file:` source or a local or workspace folder node; null for other nodes or outside. */
function folderPath(lock: string, n: NpmGraph["nodes"][number]): string | null {
  const { kind, ref } = n.source;
  const rel = kind === "file" ? (ref ?? "").replace(/^file:/, "") : kind === "local" || kind === "workspace" ? n.location : null;
  return rel === null ? null : repoPath(lock, rel);
}

const edits = (changed: readonly string[], path: string): boolean => path === "." || changed.some((c) => c === path || c.startsWith(`${path}/`));

/**
 * The content digest of each folder, as npm would install it: at base when the change leaves it alone, at the head
 * commit when the change edits it (so only an approval at base for exactly that new content admits it). Without a
 * digest no approval matches: a folder edited in worktree mode, and the repository root (`.`), whose content includes
 * the approval naming it, once anything changed.
 */
function contentDigests(ctx: Ctx, lock: string, head: NpmGraphResult): Record<string, string> {
  const out: Record<string, string> = {};
  if (head.status !== "ok") return out;
  const { root, base, head: rev, worktree, changed } = ctx.input;
  for (const n of head.graph.nodes) {
    const path = folderPath(lock, n);
    if (path === null || path in out) continue;
    const edited = edits(changed, path);
    if ((edited && (worktree || path === ".")) || opaque(ctx, path)) continue;
    const digest = contentDigestAt(root, edited ? rev : base, path);
    if (digest !== null) out[path] = digest;
  }
  return out;
}

/**
 * Lockfiles at head the change did not touch but whose `file:` source or local folder it edited (owner decision 4: a
 * change to the folder needs a new approval) or that holds a symlink (its target may be what changed, and it has no
 * digest), or is or holds a submodule (a bump changes only the gitlink's path). A workspace matching a base glob of that lockfile needs no approval (ADR-0062 decision 3), so editing it
 * judges nothing; a workspace no base glob covers is judged like a local folder. A lockfile whose head graph does not
 * parse is judged too (the evaluator holds `graph_hold`): its folders cannot be read, so it is never skipped.
 */
function lockfilesWithEditedFolders(ctx: Ctx, skip: readonly string[]): string[] {
  const { changed, policy } = ctx.input;
  if (changed.length === 0) return [];
  const out: string[] = [];
  for (const lock of ctx.headPaths) {
    if (!LOCKFILES.includes(nameOf(lock)) || inNodeModules(lock) || skip.includes(lock)) continue;
    const g = graphOf(ctx.headTree.read(lock), ctx.headTree.read(join(dirOf(lock), "package.json")), policy.limits);
    if (g?.status !== "ok") {
      out.push(lock);
      continue;
    }
    let globs: RegExp[] | null = null;
    const baseGlobs = (): RegExp[] => {
      const b = graphOf(ctx.baseTree.read(lock), ctx.baseTree.read(join(dirOf(lock), "package.json")), policy.limits);
      return (b?.status === "ok" ? b.graph.root.workspaces : []).map((x) => globToRegExp(x));
    };
    const folders = g.graph.nodes.filter((n) => {
      const folder = folderPath(lock, n);
      if (folder === null || !(edits(changed, folder) || opaque(ctx, folder))) return false;
      return n.source.kind !== "workspace" || !(globs ??= baseGlobs()).some((re) => re.test(n.location));
    });
    if (folders.length === 0) continue;
    out.push(lock);
    for (const n of folders) {
      const folder = folderPath(lock, n)!;
      const why = edits(changed, folder) && !opaque(ctx, folder)
        ? `${folder} changed while ${lock} did not: judged by the folder's content digest at head`
        : linked(ctx.links, folder)
          ? `${folder} holds or is a symlink, whose target the change may have edited: judged, and a folder with a symlink has no content digest`
          : `${folder} is, lies under or holds a submodule, whose commit the change may have moved: judged, and it has no content digest`;
      ctx.reasons.push(reason("local_folder_changed", "info", lock, n.location, why));
    }
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
  const atBase = treeAt(input, input.base);
  const atHead = treeAt(input, input.worktree ? null : input.head);
  const ctx: Ctx = {
    input,
    baseTree,
    headTree: input.worktree ? diskSourceTree(input.root) : gitSourceTree(input.root, input.head),
    approvals: approvalsAt(input, baseTree),
    allowedSigners: baseTree.read(ALLOWED_SIGNERS),
    links: new Set([...atBase.links, ...atHead.links]),
    gitlinks: new Set([...atBase.gitlinks, ...atHead.gitlinks]),
    headPaths: atHead.paths,
    reasons: [],
  };
  symlinkedDependencyFiles(ctx);
  const files = input.changed.filter(isDependencyFile);
  const locks: string[] = [];
  for (const f of files) {
    const name = nameOf(f);
    if (inNodeModules(f)) {
      ctx.reasons.push(reason("node_modules_changed", "hold", f, null, "committed node_modules content bypasses the lockfile"));
    } else if (!DEPENDENCY_NAMES.includes(name)) {
      const canonical = name.toLowerCase();
      ctx.reasons.push(reason("unsupported_dependency_file", "hold", f, null, `${name} is a case variant of ${canonical}: npm reads it on a case-insensitive checkout, and only the exact name is judged`));
    } else if (UNSUPPORTED.includes(name)) {
      ctx.reasons.push(reason("unsupported_dependency_file", "hold", f, null, `${name} is not supported (npm package-lock.json or npm-shrinkwrap.json, lockfileVersion 2 or 3)`));
    } else if (name === NPM_CONFIG) {
      const how = !ctx.headTree.has(f) ? "removed" : ctx.baseTree.has(f) ? "changed" : "added";
      ctx.reasons.push(reason("npm_config_changed", "hold", f, null, `${f} was ${how}: npm configuration in a change is data, never authority; change it in a Planner change of its own`));
    } else if (LOCKFILES.includes(name)) locks.push(f);
    else judgeManifest(ctx, f);
  }
  for (const l of input.judge ?? []) if (!locks.includes(l)) locks.push(l);
  const lockfiles = [...locks, ...lockfilesWithEditedFolders(ctx, locks)].map((l) => judgeLockfile(ctx, l));
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
