import path from "node:path";
import { gitRunOk } from "./git-repo.js";

const MISSIONS_PREFIX = ".gitagent/missions/";

function isMissionFile(rel: string): boolean {
  const norm = rel.trim().replace(/\\/g, "/");
  if (!norm.startsWith(MISSIONS_PREFIX)) return false;
  return /\.(ya?ml|md)$/i.test(norm);
}

/** Resolve merge-base for branch-scoped mission diff (pre-push). */
export function resolveMergeBase(root: string): string | null {
  const upstream = gitRunOk(root, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ]);
  if (upstream.ok && upstream.stdout.trim()) {
    const base = gitRunOk(root, ["merge-base", "HEAD", "@{upstream}"]);
    if (base.ok && base.stdout.trim()) return base.stdout.trim();
  }
  for (const ref of ["main", "master"]) {
    const base = gitRunOk(root, ["merge-base", "HEAD", ref]);
    if (base.ok && base.stdout.trim()) return base.stdout.trim();
  }
  const parent = gitRunOk(root, ["rev-parse", "HEAD~1"]);
  if (parent.ok && parent.stdout.trim()) return parent.stdout.trim();
  return null;
}

/** Repo-relative mission paths changed between base and HEAD. */
export function listDirtyMissionPaths(repoRoot: string, baseRef?: string): string[] {
  const base = baseRef?.trim() || resolveMergeBase(repoRoot);
  if (!base) return [];

  const r = gitRunOk(repoRoot, ["diff", "--name-only", `${base}..HEAD`, "--", MISSIONS_PREFIX]);
  if (!r.ok) return [];

  const paths = r.stdout
    .split("\n")
    .map((p) => p.trim().replace(/\\/g, "/"))
    .filter((p) => isMissionFile(p));

  return [...new Set(paths)].sort();
}

export function listDirtyMissionPathsAbsolute(repoRoot: string, baseRef?: string): string[] {
  return listDirtyMissionPaths(repoRoot, baseRef).map((rel) =>
    path.join(repoRoot, rel.split("/").join(path.sep)),
  );
}
