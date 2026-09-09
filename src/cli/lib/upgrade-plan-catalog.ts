import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  INTEGRATION_IDE_KEYS,
  loadIntegrationCompat,
  type IntegrationCompatManifest,
} from "./integration-compat.js";
import { loadInitAssetCatalog, type InitAssetSpec } from "./init-asset-catalog.js";
import { defaultInitProfile, type InitProfile } from "./init-profile.js";
import { toPosixRel } from "./cli-io.js";
import type { PlannedWrite } from "./init-plan.js";
import type { UpgradeFileChange } from "./upgrade-plan-types.js";

/** managed_strict substrate assets eligible for gantry upgrade (excludes user law / missions). */
export function upgradeEligibleAssets(assets: InitAssetSpec[]): InitAssetSpec[] {
  return assets.filter((a) => a.mode === "managed_strict");
}

export function allUpgradeEligibleFromCatalog(templatesRoot: string): InitAssetSpec[] {
  return upgradeEligibleAssets([...loadInitAssetCatalog(templatesRoot)]);
}

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
  profile.gitHooks =
    pathExists(repoRoot, ".githooks/pre-push") || pathExists(repoRoot, ".githooks/pre-commit");
  profile.ciWorkflow = pathExists(repoRoot, ".github/workflows/gxt-validate.yml");
  profile.skillsPreset = pathExists(repoRoot, "skills/gantry.md") ? "specimen" : "minimal";
  return profile;
}

function sha256Buffer(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function fileState(absPath: string): { bytes: number; sha256: string } | null {
  if (!fs.existsSync(absPath)) return null;
  const buf = fs.readFileSync(absPath);
  return { bytes: buf.length, sha256: sha256Buffer(buf) };
}

/** Summarize planned upgrade writes for dry-run / changelog preview. */
export function buildUpgradeFileChanges(
  repoRoot: string,
  writes: PlannedWrite[],
): UpgradeFileChange[] {
  return writes.map((w) => {
    const rel = toPosixRel(repoRoot, w.absoluteTarget);
    const before = fileState(w.absoluteTarget);
    const afterBuf = Buffer.from(w.body, "utf8");
    return {
      path: rel,
      action: before === null ? "add" : "update",
      bytes_before: before?.bytes ?? null,
      bytes_after: afterBuf.length,
      sha256_before: before?.sha256 ?? null,
      sha256_after: sha256Buffer(afterBuf),
    };
  });
}

export function groupUpgradeChangesByCategory(
  changes: UpgradeFileChange[],
): Record<string, UpgradeFileChange[]> {
  const groups: Record<string, UpgradeFileChange[]> = {
    workflows: [],
    scripts: [],
    hooks: [],
    substrate: [],
    other: [],
  };
  for (const c of changes) {
    if (c.path.startsWith(".github/workflows/")) groups.workflows!.push(c);
    else if (c.path.startsWith("scripts/")) groups.scripts!.push(c);
    else if (c.path.startsWith(".githooks/") || c.path.startsWith(".cursor/hooks")) groups.hooks!.push(c);
    else if (c.path.startsWith(".gitagent/")) groups.substrate!.push(c);
    else groups.other!.push(c);
  }
  return groups;
}
