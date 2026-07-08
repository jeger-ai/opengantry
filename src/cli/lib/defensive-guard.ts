import { gitRunOk } from "./git.js";
import { normalizeRepoRelativePath } from "./tmvc-path.js";
import { loadGxtConfig } from "./gxt-config.js";
import { resolveDefensiveProfile } from "./defensive-profile.js";
import type { Manifest } from "./types.js";
import { resolveManifestSkillKey } from "./skill-key.js";

export interface DefensiveGuardResult {
  ok: boolean;
  net_loc?: number;
  max_net_loc?: number;
  reason?: string;
}

function gitNumstat(repoRoot: string, args: string[]): number {
  const { ok, stdout } = gitRunOk(repoRoot, args);
  if (!ok) return 0;
  let total = 0;
  for (const line of stdout.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const add = parts[0] === "-" ? 0 : Number.parseInt(parts[0] ?? "0", 10);
    const del = parts[1] === "-" ? 0 : Number.parseInt(parts[1] ?? "0", 10);
    total += (Number.isFinite(add) ? add : 0) + (Number.isFinite(del) ? del : 0);
  }
  return total;
}

function pathMatchesTmvcRoot(filePath: string, roots: readonly string[]): boolean {
  const norm = normalizeRepoRelativePath(filePath);
  return roots.some((root) => {
    const r = normalizeRepoRelativePath(root);
    return norm === r || norm.startsWith(`${r.replace(/\/$/, "")}/`);
  });
}

function listChangedFilesInTmvc(repoRoot: string, tmvcRoots: readonly string[]): string[] {
  const { ok, stdout } = gitRunOk(repoRoot, ["diff", "--name-only", "HEAD"]);
  if (!ok) return [];
  const staged = gitRunOk(repoRoot, ["diff", "--name-only", "--cached"]);
  const lines = new Set<string>();
  for (const chunk of [stdout, staged.ok ? staged.stdout : ""]) {
    for (const line of chunk.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (pathMatchesTmvcRoot(trimmed, tmvcRoots)) lines.add(trimmed);
    }
  }
  return [...lines];
}

function netLocForPaths(repoRoot: string, files: readonly string[]): number {
  if (files.length === 0) return 0;
  const pathArgs = files.flatMap((f) => ["--", f]);
  const worktree = gitNumstat(repoRoot, ["diff", "--numstat", "HEAD", ...pathArgs]);
  const staged = gitNumstat(repoRoot, ["diff", "--numstat", "--cached", ...pathArgs]);
  return worktree + staged;
}

/** Net LOC across worktree + staged diffs for the given repo-relative paths. */
export function computeNetLocForFiles(repoRoot: string, files: readonly string[]): number {
  if (files.length === 0) return 0;
  const relFiles = files.map((f) => normalizeRepoRelativePath(f));
  return netLocForPaths(repoRoot, relFiles);
}

export function evaluateNetLocBudgetGuard(
  repoRoot: string,
  manifest: Manifest,
  skillKey: string,
): DefensiveGuardResult {
  const profile = resolveDefensiveProfile(loadGxtConfig(repoRoot));
  if (!profile.enabled || !profile.net_loc_budget) {
    return { ok: true };
  }

  const resolvedKey = resolveManifestSkillKey(manifest, skillKey);
  const skill = manifest.skills[resolvedKey];
  if (!skill) {
    return { ok: false, reason: `defensive guard: unknown skill ${skillKey}` };
  }

  const tmvcRoots = skill.tmvc_roots ?? [];
  const changed = listChangedFilesInTmvc(repoRoot, tmvcRoots);
  const netLoc = computeNetLocForFiles(repoRoot, changed);
  const max = profile.net_loc_budget.max_net_loc;

  if (netLoc > max) {
    return {
      ok: false,
      net_loc: netLoc,
      max_net_loc: max,
      reason: `net_loc ${netLoc} exceeds defensive_profile max_net_loc ${max}`,
    };
  }

  return { ok: true, net_loc: netLoc, max_net_loc: max };
}
