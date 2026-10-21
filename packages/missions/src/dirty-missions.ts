import { gitRunOk } from "#git/git.js";
import { fallbackPushBase } from "./git/git-hooks.js";

const MISSIONS_PREFIX = ".gitagent/missions/";

/** Docs under missions/ are not gantry verify targets (no gate/trace contract). */
const NON_VERIFIABLE_BASENAMES = new Set(["README.md"]);

/** True for YAML/Markdown mission work orders under `.gitagent/missions/` (excludes README). */
export function isVerifiableMissionPath(rel: string): boolean {
  const norm = rel.trim().replace(/\\/g, "/");
  if (!norm.startsWith(MISSIONS_PREFIX)) return false;
  if (!/\.(ya?ml|md)$/i.test(norm)) return false;
  const base = norm.slice(MISSIONS_PREFIX.length).split("/").pop() ?? "";
  if (NON_VERIFIABLE_BASENAMES.has(base)) return false;
  return true;
}

/** Repo-relative mission paths changed between base (default: the pre-push fallback base) and HEAD. */
export function listDirtyMissionPaths(repoRoot: string, baseRef?: string): string[] {
  const base = baseRef?.trim() || fallbackPushBase(repoRoot, "HEAD");
  if (!base) return [];

  const r = gitRunOk(repoRoot, [
    "diff",
    "--name-only",
    "--diff-filter=ACMRT",
    `${base}..HEAD`,
    "--",
    MISSIONS_PREFIX,
  ]);
  if (!r.ok) return [];

  const paths = r.stdout
    .split("\n")
    .map((p) => p.trim().replace(/\\/g, "/"))
    .filter((p) => isVerifiableMissionPath(p));

  return [...new Set(paths)].sort();
}
