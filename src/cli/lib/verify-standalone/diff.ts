import fs from "node:fs";
import path from "node:path";
import { GantryUserError } from "../errors.js";
import { gitRun } from "../git/git.js";

/**
 * What a change touched since the base: the files and the lines it added. Committed work is `base...HEAD` (from
 * the merge base, like a pull request); `worktree` diffs the working tree against the base and adds untracked
 * files that are not ignored, so the implementer can check before committing.
 */

export interface AddedLine {
  file: string;
  line: number;
  text: string;
}

function git(root: string, args: string[]): string {
  const r = gitRun(root, args, 512 * 1024 * 1024);
  if (!r.ok) {
    throw new GantryUserError("GXT_VERIFY_GIT_FAILED", `verify: git ${args.join(" ")} failed: ${r.stderr.trim().split("\n")[0] ?? ""}`, undefined, 2);
  }
  return r.stdout;
}

function lines(text: string): string[] {
  return text.split("\n").filter(Boolean);
}

function range(base: string, worktree: boolean): string {
  return worktree ? base : `${base}...HEAD`;
}

export function untrackedFiles(root: string): string[] {
  return lines(git(root, ["ls-files", "--others", "--exclude-standard"]));
}

/** Repo-relative POSIX paths changed since the base (renames as a delete and an add), sorted. */
export function changedFiles(root: string, base: string, worktree: boolean): string[] {
  const changed = lines(git(root, ["diff", "--name-only", "--no-renames", range(base, worktree)]));
  const untracked = worktree ? untrackedFiles(root) : [];
  return [...new Set([...changed, ...untracked])].sort();
}

function exists(root: string, rel: string): boolean {
  return fs.existsSync(path.join(root, ...rel.split("/")));
}

function fileLines(root: string, rel: string): string[] {
  const text = fs.readFileSync(path.join(root, ...rel.split("/")), "utf8");
  const out = text.split("\n");
  if (out.at(-1) === "") out.pop();
  return out;
}

/** Lines added to `files` (deletions never count); an untracked file counts in full. */
export function countAddedLines(root: string, base: string, files: readonly string[], worktree: boolean): number {
  const present = files.filter((f) => exists(root, f));
  if (present.length === 0) return 0;
  const untracked = worktree ? new Set(untrackedFiles(root)) : new Set<string>();
  const tracked = present.filter((f) => !untracked.has(f));
  let added = 0;
  if (tracked.length > 0) {
    for (const row of lines(git(root, ["diff", "--numstat", "--no-renames", range(base, worktree), "--", ...tracked]))) {
      added += Number(row.split("\t")[0]) || 0;
    }
  }
  for (const f of present.filter((x) => untracked.has(x))) added += fileLines(root, f).length;
  return added;
}

function parseUnifiedZero(diff: string): AddedLine[] {
  const out: AddedLine[] = [];
  let file: string | null = null;
  let n = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line === "+++ /dev/null" ? null : line.replace(/^\+\+\+ b\//, "");
    } else if (line.startsWith("@@")) {
      n = Number(/\+(\d+)/.exec(line)?.[1] ?? 0);
    } else if (line.startsWith("+") && file) {
      out.push({ file, line: n, text: line.slice(1) });
      n += 1;
    }
  }
  return out;
}

/** Every added line of `files` with its line number in the new version. */
export function addedLinesOf(root: string, base: string, files: readonly string[], worktree: boolean): AddedLine[] {
  const present = files.filter((f) => exists(root, f));
  if (present.length === 0) return [];
  const untracked = worktree ? new Set(untrackedFiles(root)) : new Set<string>();
  const tracked = present.filter((f) => !untracked.has(f));
  const out = tracked.length > 0
    ? parseUnifiedZero(git(root, ["diff", "-U0", "--no-color", "--no-renames", "--no-ext-diff", range(base, worktree), "--", ...tracked]))
    : [];
  for (const f of present.filter((x) => untracked.has(x))) {
    fileLines(root, f).forEach((text, i) => out.push({ file: f, line: i + 1, text }));
  }
  return out;
}

/**
 * A pattern without wildcards is the path or a folder above it ("." is everything); with `*` (one segment),
 * `**` (any depth) or `?` it is a glob over the whole path. The same semantics as COMMITLY hangar's gate.
 */
export function verifyPathMatcher(pattern: string): (file: string) => boolean {
  const clean = pattern.replace(/^\.\//, "").replace(/\/+$/, "");
  if (clean === "." || clean === "") return () => true;
  if (!/[*?]/.test(clean)) return (file) => file === clean || file.startsWith(`${clean}/`);
  const source = clean
    .split("/")
    .map((seg) => (seg === "**" ? "(?:.*)" : seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")))
    .join("/")
    .replace(/\(\?:\.\*\)\//g, "(?:.*/)?")
    .replace(/\/\(\?:\.\*\)$/, "(?:/.*)?");
  const re = new RegExp(`^${source}$`);
  return (file) => re.test(file);
}

export function anyPathOf(patterns: readonly string[]): (file: string) => boolean {
  const matchers = patterns.map(verifyPathMatcher);
  return (file) => matchers.some((m) => m(file));
}
