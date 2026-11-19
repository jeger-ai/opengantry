import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GantryUserError } from "#core/user-error.js";
import { gitRun, gitRunBytes } from "#git/git.js";
import { normalizeCageRelPath } from "./cage-config.js";
import { trustedCageGit } from "./cage-host-git.js";
import { captureRawScopeTree, listRawScopeTree, readRawScopeBlob } from "./cage-scope-raw.js";

/**
 * Baseline for a cage scope (`.cage.yaml` `allow_only:`, `--allow-only`; ADR-0048 decision 10). Everything git
 * would track outside the allowed area is protected, which is usually most of the repository: far too much to
 * hold in memory. Instead the working tree (tracked files and untracked files that are not gitignored, uncommitted
 * edits included) is written to the repository's object store as a tree, through a temporary index. The real
 * index, HEAD and refs are never touched. Changes are found by comparing blob ids; a restore reads the blob back
 * through the checkout filters. Trusted Git sessions instead select paths through a private index and
 * store the original working-tree bytes in host custody.
 */

/**
 * Globs from `.cage.yaml` `allow_only:` and from `--allow-only`. A path is in scope only when it matches a glob
 * of every list that is set, so neither source can widen the other.
 */
export interface CageScope {
  config: string[] | null;
  flag: string[] | null;
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
  /** Metadata already computed by the trusted raw scan. */
  raw?: { sha256: string; size: number; linkTarget: string | null };
}

export interface CageScopeTree {
  tree: string;
  files: CageScopeFile[];
}

const MAX_BUFFER = 512 * 1024 * 1024;
type TrustedScopeGit = NonNullable<ReturnType<typeof trustedCageGit>>;

function scopeError(code: string, message: string, hint?: string): GantryUserError {
  return new GantryUserError(code, `cage: ${message}`, hint, 2);
}

/** A git run the scope relies on; a failed or cut-short run (spawnSync error, MSN-0389) throws. */
function git(root: string, args: string[], opts: { indexFile?: string } = {}): Buffer {
  const r = gitRunBytes(root, args, { maxBuffer: MAX_BUFFER, ...(opts.indexFile ? { indexFile: opts.indexFile } : {}) });
  if (!r.ok) throw scopeError("GXT_CAGE_SCOPE_GIT_FAILED", `scope: git ${args[0] ?? ""} failed: ${r.stderr.trim().split("\n")[0] || `exit ${String(r.status)}`}`);
  return r.stdout;
}

function trustedScopeGit(context: TrustedScopeGit, indexFile: string, args: string[]): string {
  const r = spawnSync("/usr/bin/git", [
    "--no-pager",
    `--git-dir=${context.gitDir}`,
    `--work-tree=${context.root}`,
    "-c", "core.fsmonitor=false",
    "-c", "core.hooksPath=/dev/null",
    ...args,
  ], {
    cwd: context.root,
    env: {
      PATH: "/usr/bin:/bin",
      LC_ALL: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_INDEX_FILE: indexFile,
    },
    maxBuffer: MAX_BUFFER,
  });
  if (r.error || r.status !== 0) {
    const reason = r.error?.message || r.stderr?.toString().trim().split("\n")[0] || `exit ${String(r.status)}`;
    throw scopeError("GXT_CAGE_SCOPE_GIT_FAILED", `scope: trusted git ${args[0]} failed: ${reason}`);
  }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(r.stdout);
}

function trustedPaths(context: TrustedScopeGit, indexFile: string): string[] {
  const tracked = new Set<string>();
  for (const record of trustedScopeGit(context, indexFile, ["ls-files", "--stage", "-z"]).split("\0")) {
    if (record && !record.startsWith("160000 ")) tracked.add(record.slice(record.indexOf("\t") + 1));
  }
  for (const rel of trustedScopeGit(context, indexFile, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0")) {
    if (rel && !rel.endsWith("/")) tracked.add(rel);
  }
  return [...tracked].sort();
}

/** The scope needs a git work tree at the cage root; anything else fails closed before the command runs. */
export function assertCageScopeGitRoot(root: string): void {
  const trusted = trustedCageGit(root);
  if (trusted) {
    trustedScopeGit(trusted, trusted.indexFile, ["rev-parse", "--show-toplevel"]);
    return;
  }
  const r = gitRun(root, ["rev-parse", "--show-toplevel"]);
  const top = r.ok ? r.stdout.trim() : "";
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
  const trusted = trustedCageGit(root);
  const real = trusted?.indexFile ?? git(root, ["rev-parse", "--path-format=absolute", "--git-path", "index"]).toString("utf8").trim();
  const dir = fs.mkdtempSync(path.join(trusted?.stateDir ?? os.tmpdir(), "gantry-cage-scope-"));
  const file = path.join(dir, "index");
  try {
    fs.copyFileSync(real, file);
  } catch (err) {
    if (trusted && (err as NodeJS.ErrnoException).code !== "ENOENT") {
      fs.rmSync(dir, { recursive: true, force: true });
      throw err;
    }
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
export function captureCageScopeTree(
  root: string,
  indexFile: string,
  opts: { persist?: boolean; baselineTree?: string } = {},
): CageScopeTree {
  const trusted = trustedCageGit(root);
  if (trusted) {
    const paths = new Set(trustedPaths(trusted, indexFile));
    const baselineFile = path.join(path.dirname(indexFile), "baseline-tree");
    const baselineTree = opts.baselineTree ?? (fs.existsSync(baselineFile) ? fs.readFileSync(baselineFile, "utf8") : null);
    if (baselineTree) {
      for (const entry of listRawScopeTree(trusted.stateDir, baselineTree)) paths.add(entry.rel);
    }
    const persist = opts.persist !== false;
    const result = captureRawScopeTree(trusted.root, trusted.stateDir, [...paths].sort(), persist);
    if (persist) fs.writeFileSync(baselineFile, result.tree, { mode: 0o600 });
    return result;
  }
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
  const trusted = trustedCageGit(root);
  if (trusted) return listRawScopeTree(trusted.stateDir, tree);
  return listTree(root, tree);
}

/** The original raw bytes for trusted sessions, otherwise a blob as Git checkout would write it. */
export function readCageScopeBlob(root: string, rel: string, oid: string): Buffer {
  const trusted = trustedCageGit(root);
  if (trusted) return readRawScopeBlob(trusted.stateDir, oid);
  return git(root, ["cat-file", "--filters", `--path=${rel}`, oid]);
}
