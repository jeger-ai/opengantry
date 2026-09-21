import fs from "node:fs";
import path from "node:path";
import { normalizeContractPath } from "./contract-hash.js";
import { isPathUnderRoot } from "../tmvc-path.js";

const PATH_TOKEN_RE = /(?:\.{0,2}\/)?[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+\/?/g;

export function existsRepoPath(root: string, rel: string): boolean {
  return fs.existsSync(path.join(root, rel));
}

/** Path-like tokens from intent prose (same regex as contract propose). */
export function intentPathTokens(intent: string): string[] {
  const out: string[] = [];
  for (const m of intent.matchAll(PATH_TOKEN_RE)) {
    const norm = normalizeContractPath(m[0]!);
    if (norm && !norm.includes("://")) out.push(norm);
  }
  return out;
}

export function intersectWithSkillRoots(
  candidates: readonly string[],
  skillRoots: readonly string[],
): string[] {
  if (skillRoots.length === 0) return [...candidates];
  return candidates.filter((c) => skillRoots.some((s) => isPathUnderRoot(c, s)));
}

/** Intent/--path hints that exist on disk and sit under skill roots. */
export function existingHintedPaths(
  root: string,
  intent: string,
  paths: readonly string[] | undefined,
  skillRoots: readonly string[],
): string[] {
  const hinted = [...intentPathTokens(intent), ...(paths ?? []).map(normalizeContractPath)];
  const existing = [...new Set(hinted)].filter((p) => existsRepoPath(root, p.replace(/\/$/, ""))).sort();
  return intersectWithSkillRoots(existing, skillRoots);
}
