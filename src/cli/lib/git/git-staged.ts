import { spawnSync } from "node:child_process";
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

export type GitStagedBlobResult =
  | { ok: true; content: Buffer }
  | { ok: false; reason: string };

/**
 * Read staged index bytes for a repo-relative path (`git show :path`).
 * Never reads the working tree — index-fidelity for pre-commit guards.
 */
export function gitReadStagedBlob(repoRoot: string, repoRel: string): GitStagedBlobResult {
  const r = spawnSync("git", ["-C", repoRoot, "show", `:${repoRel}`], {
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status !== 0) {
    const stderr = typeof r.stderr === "string" ? r.stderr : r.stderr?.toString("utf8") ?? "";
    return { ok: false, reason: stderr.trim() || `git show :${repoRel} failed` };
  }
  const buf = r.stdout;
  if (!Buffer.isBuffer(buf)) {
    return { ok: false, reason: `git show :${repoRel} returned no buffer` };
  }
  return { ok: true, content: buf };
}

/** Stage a repo-relative path (`git add -- path`). */
export function gitStagePath(repoRoot: string, repoRel: string): { ok: boolean; stderr: string } {
  const r = gitRun(repoRoot, ["add", "--", repoRel]);
  return { ok: r.ok, stderr: r.stderr.trim() };
}
