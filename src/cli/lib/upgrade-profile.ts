import fs from "node:fs";
import path from "node:path";
import {
  INTEGRATION_IDE_KEYS,
  loadIntegrationCompat,
  type IntegrationCompatManifest,
} from "./integration-compat.js";
import { defaultInitProfile, type InitProfile } from "./init-profile.js";

function pathExists(repoRoot: string, rel: string): boolean {
  return fs.existsSync(path.join(repoRoot, rel.split("/").join(path.sep)));
}

function detectIntegrationPresent(
  repoRoot: string,
  key: string,
  entry: IntegrationCompatManifest["integrations"][typeof INTEGRATION_IDE_KEYS[number]],
): boolean {
  if (key === "codex-cli") {
    return pathExists(repoRoot, ".codex/config.toml");
  }
  return entry.canonical_paths.some((p) => pathExists(repoRoot, p));
}

/** Infer init profile from on-disk substrate assets for upgrade planning. */
export function inferInitProfileFromRepo(repoRoot: string, templatesRoot?: string): InitProfile {
  const profile = defaultInitProfile();
  const compat = loadIntegrationCompat(templatesRoot);
  const detected = INTEGRATION_IDE_KEYS.filter((key) =>
    detectIntegrationPresent(repoRoot, key, compat.integrations[key]),
  );
  if (detected.length > 0) {
    profile.ides = detected;
  }
  profile.gitHooks = pathExists(repoRoot, ".githooks/pre-push");
  profile.ciWorkflow = pathExists(repoRoot, ".github/workflows/gxt-validate.yml");
  profile.skillsPreset = pathExists(repoRoot, "skills/gapman.md") ? "specimen" : "minimal";
  return profile;
}
