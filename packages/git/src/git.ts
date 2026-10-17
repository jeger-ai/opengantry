import { execSync, spawnSync } from "node:child_process";
import path from "node:path";
import { CLI_NAME } from "../constants.js";

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

/** Run git in repository root (`git -C root ...args`). Third arg is maxBuffer or options. */
export function gitRun(
  repoRoot: string,
  args: string[],
  maxBufferOrOpts: number | GitRunOptions = 32 * 1024 * 1024,
): GitRunResult {
  const opts: GitRunOptions =
    typeof maxBufferOrOpts === "number" ? { maxBuffer: maxBufferOrOpts } : maxBufferOrOpts;
  const maxBuffer = opts.maxBuffer ?? 32 * 1024 * 1024;
  const r = spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    maxBuffer,
    env: gitChildEnv(opts.env),
    ...(opts.input !== undefined ? { input: opts.input } : {}),
  });
  return {
    ok: r.status === 0,
    stdout: typeof r.stdout === "string" ? r.stdout : "",
    stderr: typeof r.stderr === "string" ? r.stderr : "",
    status: r.status,
  };
}

export function gitRunOk(
  repoRoot: string,
  args: string[],
  maxBuffer = 32 * 1024 * 1024,
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
