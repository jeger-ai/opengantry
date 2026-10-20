import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { GantryUserError } from "#core/user-error.js";
import { gitChildEnv } from "#git/git.js";
import { patternCoversPath } from "#core/path-glob.js";
import { normalizeCageRelPath } from "./cage-config.js";

/**
 * Baseline for a cage scope (`.cage.yaml` `allow_only:`, `--allow-only`; ADR-0048 decision 10). Everything git
 * would track outside the allowed area is protected, which is usually most of the repository: far too much to
 * hold in memory. Instead the working tree (tracked files and untracked files that are not gitignored, uncommitted
 * edits included) is written to the repository's object store as a tree, through a temporary index. The real
 * index, HEAD and refs are never touched. Changes are found by comparing blob ids; a restore reads the blob back
 * through the checkout filters, so the file gets the bytes it had on disk.
 */

/**
 * Globs from `.cage.yaml` `allow_only:` and from `--allow-only`. A path is in scope only when it matches a glob
 * of every list that is set, so neither source can widen the other.
 */
export interface CageScope {
  config: string[] | null;
  flag: string[] | null;
}

/** A glob that matches the path, or a directory above it, covers the path. */
function scopeListCovers(globs: readonly string[], rel: string): boolean {
  return globs.some((g) => patternCoversPath(g, rel));
}

/** Whether a root-relative path lies in the allowed area; always true without a scope. */
export function inCageScope(plan: { scope: CageScope | null }, rel: string): boolean {
  const s = plan.scope;
  if (!s) return true;
  // Paths under the git dir are git_control's business, never the scope's.
  if (rel === ".git" || rel.startsWith(".git/") || rel.startsWith("../")) return true;
  if (s.config && !scopeListCovers(s.config, rel)) return false;
  if (s.flag && !scopeListCovers(s.flag, rel)) return false;
  return true;
}

/** `--allow-only` values, normalized; null when none were given. */
export function parseCageScopeFlag(raw: readonly string[] | undefined): string[] | null {
  if (!raw || raw.length === 0) return null;
  return raw.map((g) => {
    const value = normalizeCageRelPath(g);
    if (!value) {
      throw new GantryUserError(
        "GXT_CAGE_SCOPE_INVALID",
        `cage: --allow-only ${g}: expected a root-relative glob without ".." or a leading "/"`,
        undefined,
        2,
      );
    }
    return value;
  });
}

/** One file in a scope tree. */
export interface CageScopeFile {
  /** Root-relative POSIX path. */
  rel: string;
  /** Git blob id. */
  oid: string;
  type: "file" | "symlink";
  fileMode: number;
}

export interface CageScopeTree {
  tree: string;
  files: CageScopeFile[];
}

const MAX_BUFFER = 512 * 1024 * 1024;

function scopeError(code: string, message: string, hint?: string): GantryUserError {
  return new GantryUserError(code, `cage: ${message}`, hint, 2);
}

function git(root: string, args: string[], opts: { indexFile?: string } = {}): Buffer {
  const env = gitChildEnv();
  if (opts.indexFile) env.GIT_INDEX_FILE = opts.indexFile;
  const r = spawnSync("git", ["-C", root, ...args], { env, maxBuffer: MAX_BUFFER });
  if (r.status !== 0) {
    const err = r.stderr ? r.stderr.toString("utf8").trim().split("\n")[0] : String(r.error ?? r.status);
    throw scopeError("GXT_CAGE_SCOPE_GIT_FAILED", `scope: git ${args[0] ?? ""} failed: ${err}`);
  }
  return r.stdout;
}

/** The scope needs a git work tree at the cage root; anything else fails closed before the command runs. */
export function assertCageScopeGitRoot(root: string): void {
  const r = spawnSync("git", ["-C", root, "rev-parse", "--show-toplevel"], { env: gitChildEnv(), encoding: "utf8" });
  const top = r.status === 0 ? r.stdout.trim() : "";
  if (!top || path.resolve(fs.realpathSync(top)) !== path.resolve(fs.realpathSync(root))) {
    throw scopeError(
      "GXT_CAGE_SCOPE_NOT_GIT",
      "scope (allow_only / --allow-only) needs a git work tree at the cage root; the command was not run",
      "Run it from the top of a git repository, or drop the scope.",
    );
  }
}

/** A temporary index seeded from the real one, so the first `git add -A` only hashes what changed. */
export function createCageScopeIndex(root: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gantry-cage-scope-"));
  const file = path.join(dir, "index");
  const real = git(root, ["rev-parse", "--path-format=absolute", "--git-path", "index"]).toString("utf8").trim();
  try {
    fs.copyFileSync(real, file);
  } catch {
    // No index yet (fresh repository): git starts an empty one.
  }
  return file;
}

export function disposeCageScopeIndex(indexFile: string): void {
  fs.rmSync(path.dirname(indexFile), { recursive: true, force: true });
}

const MODE: Record<string, { type: CageScopeFile["type"]; fileMode: number } | undefined> = {
  "100644": { type: "file", fileMode: 0o644 },
  "100755": { type: "file", fileMode: 0o755 },
  "120000": { type: "symlink", fileMode: 0o777 },
};

/** Entries of `tree`, recursively; gitlinks (submodules) are left out. */
function listTree(root: string, tree: string): CageScopeFile[] {
  const out: CageScopeFile[] = [];
  for (const rec of git(root, ["ls-tree", "-r", "-z", "--full-tree", tree]).toString("utf8").split("\0")) {
    if (!rec) continue;
    const tab = rec.indexOf("\t");
    const [mode, kind, oid] = rec.slice(0, tab).split(" ");
    const m = MODE[mode ?? ""];
    if (kind !== "blob" || !m || !oid) continue;
    out.push({ rel: rec.slice(tab + 1), oid, ...m });
  }
  return out;
}

/** Listing cache: a tree id names its content, so an unchanged tree is never listed twice. */
const listings = new Map<string, CageScopeFile[]>();

/**
 * Write the working tree as a git tree through `indexFile` (a temporary index, never the real one) and list it.
 * Honours .gitignore, so ignored files are not in it.
 */
export function captureCageScopeTree(root: string, indexFile: string): CageScopeTree {
  git(root, ["add", "-A", "--", "."], { indexFile });
  const tree = git(root, ["write-tree"], { indexFile }).toString("utf8").trim();
  const key = `${root}\0${tree}`;
  let files = listings.get(key);
  if (!files) {
    files = listTree(root, tree);
    listings.clear();
    listings.set(key, files);
  }
  return { tree, files };
}

/** The files of a tree recorded earlier (journal recovery). */
export function listCageScopeTree(root: string, tree: string): CageScopeFile[] {
  return listTree(root, tree);
}

/** A blob as the checkout would write it (smudge and eol filters applied for `rel`). */
export function readCageScopeBlob(root: string, rel: string, oid: string): Buffer {
  return git(root, ["cat-file", "--filters", `--path=${rel}`, oid]);
}
