import { getRepoRoot } from "./git.js";
import { loadManifest } from "./manifest.js";
import { checkSkillManifestSync, type SkillSyncResult } from "./skill-sync.js";
import type { Manifest } from "./types.js";

export interface Workspace {
  root: string;
  manifest: Manifest;
}

export function loadWorkspace(): Workspace {
  const root = getRepoRoot();
  const manifest = loadManifest(root);
  return { root, manifest };
}

export function loadWorkspaceWithSkillSync(): Workspace & { skillSync: SkillSyncResult } {
  const { root, manifest } = loadWorkspace();
  const skillSync = checkSkillManifestSync(root, manifest);
  return { root, manifest, skillSync };
}
