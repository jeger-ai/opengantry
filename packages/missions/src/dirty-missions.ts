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

