import fs from "node:fs";
import path from "node:path";
import { GantryUserError } from "#core/user-error.js";
import { gitRun } from "#git/git.js";

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

/** NUL-separated git output: paths arrive unquoted, whatever bytes they hold. */
function zlines(text: string): string[] {
  return text.split("\0").filter(Boolean);
}

function range(base: string, worktree: boolean): string {
  return worktree ? base : `${base}...HEAD`;
}

export function untrackedFiles(root: string): string[] {
  return zlines(git(root, ["ls-files", "-z", "--others", "--exclude-standard"]));
}

/** Repo-relative POSIX paths changed since the base (renames as a delete and an add), sorted. */
export function changedFiles(root: string, base: string, worktree: boolean): string[] {
  const changed = zlines(git(root, ["diff", "--name-only", "-z", "--no-renames", range(base, worktree)]));
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
    // With -z and no renames each record is "added<TAB>deleted<TAB>path"; binary files report "-".
    for (const row of zlines(git(root, ["diff", "--numstat", "-z", "--no-renames", range(base, worktree), "--", ...tracked]))) {
      added += Number(row.split("\t")[0]) || 0;
    }
  }
  for (const f of present.filter((x) => untracked.has(x))) added += fileLines(root, f).length;
  return added;
}

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * Added lines of one file's `-U0` diff. The hunk header says how many lines it adds, so an added line that itself
 * starts with "++ " is never mistaken for a file header.
 */
function parseUnifiedZero(file: string, diff: string): AddedLine[] {
  const out: AddedLine[] = [];
  let n = 0;
  let left = 0;
  for (const line of diff.split("\n")) {
    if (left > 0 && line.startsWith("+")) {
      out.push({ file, line: n, text: line.slice(1) });
      n += 1;
      left -= 1;
      continue;
    }
    const hunk = HUNK.exec(line);
    if (hunk) {
      n = Number(hunk[1]);
      left = hunk[2] === undefined ? 1 : Number(hunk[2]);
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
  // One diff per file: the file name comes from the list, never from a (possibly quoted) diff header.
  const out = tracked.flatMap((f) =>
    parseUnifiedZero(f, git(root, ["diff", "-U0", "--no-color", "--no-renames", "--no-ext-diff", range(base, worktree), "--", f])),
  );
  for (const f of present.filter((x) => untracked.has(x))) {
    fileLines(root, f).forEach((text, i) => out.push({ file: f, line: i + 1, text }));
  }
  return out;
}

