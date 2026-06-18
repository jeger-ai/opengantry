#!/usr/bin/env node
/**
 * Generates templates/integrations/asset-catalog.json from compatibility.json,
 * static asset metadata, and template directory scans.
 *
 * - Static assets preserve hand-tuned tags/modes (no metadata amputation).
 * - IDE assets are discovered from disk; rules assign tags/mode/executable.
 * - Output is sorted deterministically; paths are repo-relative POSIX only.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STATIC_ASSETS } from "./lib/asset-catalog-static.mjs";
import { discoverIdeAssets, formatCatalog } from "./lib/asset-catalog-discovery.mjs";
import {
  assertCanonicalPathsCovered,
  assertHookTemplatesInCatalog,
  assertNoDuplicateTargets,
  assertRepoOnlyScriptsExcluded,
  assertTemplateFilesExist,
  atomicWrite,
} from "./lib/asset-catalog-assert.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATES_DIR = path.join(REPO_ROOT, "templates");
const COMPAT_PATH = path.join(TEMPLATES_DIR, "integrations/compatibility.json");
const METADATA_PATH = path.join(TEMPLATES_DIR, "integrations/asset-metadata.json");
const CATALOG_PATH = path.join(TEMPLATES_DIR, "integrations/asset-catalog.json");

function loadMetadataOverlay() {
  if (!fs.existsSync(METADATA_PATH)) return null;
  const raw = JSON.parse(fs.readFileSync(METADATA_PATH, "utf8"));
  if (!Array.isArray(raw.static_assets)) return null;
  return raw.static_assets;
}

function main() {
  const compat = JSON.parse(fs.readFileSync(COMPAT_PATH, "utf8"));
  if (compat.schema_version !== "1" || !compat.integrations) {
    throw new Error(`${COMPAT_PATH}: unsupported compatibility manifest`);
  }

  const staticAssets = loadMetadataOverlay() ?? STATIC_ASSETS;
  const ideAssets = discoverIdeAssets(TEMPLATES_DIR, compat);
  const assets = [...staticAssets, ...ideAssets].sort((a, b) =>
    a.targetPath.localeCompare(b.targetPath),
  );

  assertNoDuplicateTargets(assets);
  assertRepoOnlyScriptsExcluded(assets);
  assertCanonicalPathsCovered(compat.integrations, assets);
  assertHookTemplatesInCatalog(TEMPLATES_DIR, assets);
  assertTemplateFilesExist(TEMPLATES_DIR, assets);

  const payload = formatCatalog(assets);
  atomicWrite(CATALOG_PATH, payload);
  console.log(`gen-asset-catalog: wrote ${assets.length} assets to integrations/asset-catalog.json`);
}

main();
