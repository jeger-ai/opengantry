import { gitRun } from "./git.js";

/** Staged paths from the index (not working tree). */
export function gitStagedNameOnly(repoRoot: string): string[] {
  const r = gitRun(repoRoot, ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
  if (!r.ok) return [];
  return r.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Stage a repo-relative path (`git add -- path`). */
export function gitStagePath(repoRoot: string, repoRel: string): { ok: boolean; stderr: string } {
  const r = gitRun(repoRoot, ["add", "--", repoRel]);
  return { ok: r.ok, stderr: r.stderr.trim() };
}
