import path from "node:path";
import { toPosixRel } from "./cli-io.js";
import { gitRunOk } from "./git-repo.js";
import { REL_MISSIONS_PREFIX } from "./git-proof.js";

const MISSION_EXTENSIONS = new Set([".yaml", ".yml", ".md"]);

function isMissionFile(repoRel: string): boolean {
  const norm = repoRel.replace(/\\/g, "/");
  if (!norm.startsWith(REL_MISSIONS_PREFIX)) return false;
  const ext = path.extname(norm).toLowerCase();
  return MISSION_EXTENSIONS.has(ext);
}

/** Discover mission files changed between baseRef and HEAD (inclusive triple-dot). */
export function discoverChangedMissionFiles(repoRoot: string, baseRef: string): string[] {
  const { ok, stdout } = gitRunOk(repoRoot, [
    "diff",
    "--name-only",
    `${baseRef}...HEAD`,
    "--",
    REL_MISSIONS_PREFIX,
  ]);
  if (!ok) return [];
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && isMissionFile(line))
    .map((rel) => toPosixRel(repoRoot, path.join(repoRoot, rel)));
}
