import fs from "node:fs";
import path from "node:path";
import {
  loadIntegrationCompat,
  type IntegrationCompatManifest,
} from "./integration-compat.js";
import type { InitProfile } from "./init-profile.js";

export type InitAssetMode = "scaffold_only" | "managed_strict";

export interface InitAsset {
  targetPath: string;
  mode: InitAssetMode;
  executable?: boolean;
}

export type InitAssetTag =
  | "core"
  | "skill-minimal"
  | "skill-specimen"
  | "hooks"
  | "ci"
  | "runtime"
  | "cursor"
  | "claude-code"
  | "codex-cli"
  | "opencode"
  | "junie"
  | "antigravity"
  | "cline"
  | "aider"
  | "openhands";

export interface InitAssetSpec extends InitAsset {
  /** Template path relative to templates/ (defaults to targetPath). */
  templatePath?: string;
  tags: InitAssetTag[];
}

interface AssetCatalogJson {
  schema_version: string;
  assets: InitAssetSpec[];
}

const catalogCache = new Map<string, InitAssetSpec[]>();

export function loadInitAssetCatalog(templatesRoot: string): readonly InitAssetSpec[] {
  const cached = catalogCache.get(templatesRoot);
  if (cached) return cached;

  const compat = loadIntegrationCompat(templatesRoot);
  const catalogRel = compat.asset_catalog ?? "integrations/asset-catalog.json";
  const catalogPath = path.join(templatesRoot, catalogRel.split("/").join(path.sep));
  if (!fs.existsSync(catalogPath)) {
    throw new Error(`missing init asset catalog at ${catalogRel}`);
  }
  const raw = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as AssetCatalogJson;
  if (raw.schema_version !== "1" || !Array.isArray(raw.assets)) {
    throw new Error(`${catalogRel}: unsupported schema`);
  }
  catalogCache.set(templatesRoot, raw.assets);
  return raw.assets;
}

function skillTag(profile: InitProfile): InitAssetTag {
  return profile.skillsPreset === "minimal" ? "skill-minimal" : "skill-specimen";
}

function assetMatchesProfile(asset: InitAssetSpec, profile: InitProfile): boolean {
  const skill = skillTag(profile);
  const activeTags = new Set<InitAssetTag>([
    "core",
    skill,
    "runtime",
    ...(profile.gitHooks ? (["hooks"] as InitAssetTag[]) : []),
    ...(profile.ciWorkflow ? (["ci"] as InitAssetTag[]) : []),
    ...profile.ides,
  ]);
  return asset.tags.some((t) => activeTags.has(t));
}

export function resolveAssetsFromProfile(
  profile: InitProfile,
  compat: IntegrationCompatManifest,
  templatesRoot: string,
): InitAssetSpec[] {
  void compat;
  return loadInitAssetCatalog(templatesRoot).filter((a) => assetMatchesProfile(a, profile));
}

export function templatePathForAsset(asset: InitAssetSpec): string {
  return (asset.templatePath ?? asset.targetPath).split("/").join(path.sep);
}
