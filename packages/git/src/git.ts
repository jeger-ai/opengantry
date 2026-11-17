import { execSync, spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from "node:child_process";
import path from "node:path";
import { CLI_NAME } from "#core/constants.js";
import { GantryUserError } from "#core/user-error.js";

/**
 * Environment variables that tell git which repository to use (MSN-0266). git sets `GIT_DIR` for hooks run in a
 * linked worktree, so a child that inherits it acts on that repository whatever its cwd: the 2026-10-15 incident
 * had pre-push gate fixtures rewrite the real repository's config and push to its origin. Config variables
 * (`GIT_CONFIG_*`, `GIT_CONFIG_PARAMETERS`) are not on the list: the cage session push guard injects
 * `core.hooksPath` through them (ADR-0048 decision 5).
 */
export const GIT_REPO_LOCATION_ENV = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
] as const;

/** Copy of `env` without {@link GIT_REPO_LOCATION_ENV}, so git in a child finds its repository from its cwd. */
export function withoutGitRepoEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const copy: NodeJS.ProcessEnv = { ...env };
  for (const key of GIT_REPO_LOCATION_ENV) delete copy[key];
  return copy;
}

/**
 * Copy of the process env for a git child. The repository-location variables are removed from the
 * copy only (never from `process.env`) so `git -C <root>` is authoritative and cannot resolve
 * into a parent repository.
 */
export function gitChildEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return withoutGitRepoEnv({ ...process.env, GIT_OPTIONAL_LOCKS: "0", ...extra });
}

export interface GitRunOptions {
  maxBuffer?: number;
  input?: string;
  env?: NodeJS.ProcessEnv;
  /** `GIT_INDEX_FILE` for this run only (set after the repository-location variables are removed). */
  indexFile?: string;
}

export function getRepoRoot(cwd = process.cwd()): string {
  try {
    const out = execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: gitChildEnv(),
    }).trim();
    if (!out) throw new Error("empty root");
    return path.resolve(cwd, out);
  } catch {
    throw new Error(`${CLI_NAME}: not inside a git repository`);
  }
}

export interface GitRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
}

const DEFAULT_MAX_BUFFER = 32 * 1024 * 1024;

type GitSpawn = (command: string, args: string[], options: SpawnSyncOptions) => SpawnSyncReturns<string | Buffer>;
let gitSpawn: GitSpawn = spawnSync;
/** Test seam (MSN-0389): the spawnSync every git run goes through; null restores the real one. */
export function setGitSpawnForTests(spawn: GitSpawn | null): void {
  gitSpawn = spawn ?? spawnSync;
}

/**
 * Run git in repository root (`git -C root ...args`) and keep stdout as bytes. A run is ok only when git exited 0
 * on its own and spawnSync reports no error (MSN-0389): when git exits before Node notices the output overflowed
 * `maxBuffer`, spawnSync reports status 0 with stdout cut short and only `error` (ENOBUFS) shows it. A run with an
 * error or a signal returns no stdout and status null, so no caller can read a partial listing as the whole.
 */
export function gitRunBytes(repoRoot: string, args: string[], opts: GitRunOptions = {}): { ok: boolean; stdout: Buffer; stderr: string; status: number | null } {
  const env = gitChildEnv(opts.env);
  if (opts.indexFile) env.GIT_INDEX_FILE = opts.indexFile;
  const r = gitSpawn("git", ["-C", repoRoot, ...args], {
    maxBuffer: opts.maxBuffer ?? DEFAULT_MAX_BUFFER,
    env,
    ...(opts.input !== undefined ? { input: opts.input } : {}),
  });
  const stderr = r.stderr == null ? "" : r.stderr.toString();
  const broken = r.error ? r.error.message : r.signal ? `git killed by ${r.signal}` : null;
  if (broken !== null) return { ok: false, stdout: Buffer.alloc(0), stderr: stderr ? `${broken}\n${stderr}` : broken, status: null };
  const stdout = r.stdout == null ? Buffer.alloc(0) : Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.from(r.stdout);
  return { ok: r.status === 0, stdout, stderr, status: r.status };
}

/** Run git in repository root (`git -C root ...args`); see {@link gitRunBytes}. Third arg is maxBuffer or options. */
export function gitRun(repoRoot: string, args: string[], maxBufferOrOpts: number | GitRunOptions = DEFAULT_MAX_BUFFER): GitRunResult {
  const r = gitRunBytes(repoRoot, args, typeof maxBufferOrOpts === "number" ? { maxBuffer: maxBufferOrOpts } : maxBufferOrOpts);
  return { ...r, stdout: r.stdout.toString("utf8") };
}

/**
 * stdout of a git read that must succeed: a failed or cut-short read throws instead of reading as empty (MSN-0389),
 * as a `GantryUserError` with `code` when one is given.
 */
export function gitOutput(repoRoot: string, args: string[], opts: { maxBuffer?: number; code?: string } = {}): string {
  const r = gitRun(repoRoot, args, opts.maxBuffer ?? DEFAULT_MAX_BUFFER);
  if (r.ok) return r.stdout;
  const message = `${CLI_NAME}: git ${args.join(" ")} failed: ${r.stderr.trim().split("\n")[0] || `exit ${String(r.status)}`}`;
  throw opts.code ? new GantryUserError(opts.code, message, undefined, 2) : new Error(message);
}

/**
 * A file at a commit: its text, `text: null` only when git lists nothing at that path, and `ok: false` when the
 * listing or the read fails or the path is not a file. A failed read is never "absent" (MSN-0389).
 */
export function gitBlobAt(repoRoot: string, rev: string, rel: string, maxBuffer = DEFAULT_MAX_BUFFER): { ok: true; text: string | null } | { ok: false; stderr: string } {
  if (rel.split("/").some((c) => c === "" || c === "." || c === "..")) return { ok: false, stderr: `not a normalized repository path: ${JSON.stringify(rel)}` }; // "./a" would list nothing: never "absent"
  const listed = gitRun(repoRoot, ["ls-tree", "-z", "--full-tree", rev, "--", rel]);
  if (!listed.ok) return { ok: false, stderr: listed.stderr.trim() || "git ls-tree failed" };
  const entry = listed.stdout.split("\0").find((e) => e.slice(e.indexOf("\t") + 1) === rel);
  if (entry === undefined) return { ok: true, text: null };
  if (entry.split(" ")[1] !== "blob") return { ok: false, stderr: `${rel} at ${rev.slice(0, 12)} is not a file` };
  const r = gitRun(repoRoot, ["cat-file", "blob", `${rev}:${rel}`], maxBuffer);
  return r.ok ? { ok: true, text: r.stdout } : { ok: false, stderr: r.stderr.trim() || "git cat-file failed" };
}

export function gitRunOk(
  repoRoot: string,
  args: string[],
  maxBuffer = DEFAULT_MAX_BUFFER,
): { ok: boolean; stdout: string } {
  const r = gitRun(repoRoot, args, maxBuffer);
  return { ok: r.ok, stdout: r.stdout };
}

export function gitRevParse(repoRoot: string, ref: string): string | null {
  const r = gitRunOk(repoRoot, ["rev-parse", "--verify", `${ref}^{commit}`]);
  return r.ok && r.stdout.trim() ? r.stdout.trim() : null;
}

export function gitHead(repoRoot: string): string | null {
  const r = gitRunOk(repoRoot, ["rev-parse", "HEAD"]);
  return r.ok && r.stdout.trim() ? r.stdout.trim() : null;
}

export function gitLogSubjects(repoRoot: string, grep: string, limit: number): string[] {
  const r = gitRunOk(repoRoot, ["log", `--grep=${grep}`, `-${limit}`, "--format=%s"]);
  if (!r.ok || !r.stdout.trim()) return [];
  return r.stdout.split("\n").filter(Boolean);
}

export function gitConfigGet(repoRoot: string, key: string): string | null {
  const r = gitRunOk(repoRoot, ["config", "--get", key]);
  if (!r.ok || !r.stdout.trim()) return null;
  return r.stdout.trim();
}

export function gitConfigSet(repoRoot: string, key: string, value: string): boolean {
  return gitRunOk(repoRoot, ["config", key, value]).ok;
}

export type GitDiffSinceCommitResult =
  | { ok: true; paths: string[] }
  | { ok: false; stderr: string };

/** Paths under tmvcRoots that differ between ref and the working tree; empty paths = fresh. */
export function gitDiffNameOnlySinceCommit(
  repoRoot: string,
  commit: string,
  tmvcRoots: readonly string[],
): GitDiffSinceCommitResult {
  const roots = tmvcRoots.map((r) => r.trim()).filter((r) => r.length > 0);
  if (roots.length === 0) return { ok: true, paths: [] };

  const r = gitRun(repoRoot, ["diff", "--name-only", commit, "--", ...roots]);
  if (!r.ok) return { ok: false, stderr: r.stderr.trim() || "git diff failed" };
  const paths = r.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return { ok: true, paths };
}
