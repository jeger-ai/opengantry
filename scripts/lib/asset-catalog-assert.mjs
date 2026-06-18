import fs from "node:fs";
import path from "node:path";
import { isRepoOnlyScript } from "./asset-catalog-static.mjs";

/** @typedef {{ targetPath: string; mode: string; tags: string[]; templatePath?: string; executable?: boolean }} AssetSpec */

/** @param {AssetSpec[]} assets */
export function assertRepoOnlyScriptsExcluded(assets) {
  /** @type {string[]} */
  const leaked = [];
  for (const asset of assets) {
    if (!asset.targetPath.startsWith("scripts/")) continue;
    if (isRepoOnlyScript(asset.targetPath)) {
      leaked.push(asset.targetPath);
    }
  }
  if (leaked.length > 0) {
    throw new Error(
      `repo-only scripts must not appear in init catalog (see REPO_ONLY_SCRIPTS):\n  ${leaked.join("\n  ")}`,
    );
  }
}

/** @param {AssetSpec[]} assets */
export function assertNoDuplicateTargets(assets) {
  const seen = new Set();
  for (const asset of assets) {
    if (seen.has(asset.targetPath)) {
      throw new Error(`duplicate targetPath in catalog: ${asset.targetPath}`);
    }
    seen.add(asset.targetPath);
  }
}

/**
 * @param {Record<string, { canonical_paths?: string[] }>} integrations
 * @param {AssetSpec[]} assets
 */
export function assertCanonicalPathsCovered(integrations, assets) {
  const targets = new Set(assets.map((a) => a.targetPath));
  /** @type {string[]} */
  const missing = [];
  for (const [key, entry] of Object.entries(integrations)) {
    for (const canonical of entry.canonical_paths ?? []) {
      if (!targets.has(canonical)) {
        missing.push(`${key}: ${canonical}`);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(`canonical_paths missing from generated catalog:\n  ${missing.join("\n  ")}`);
  }
}

/**
 * @param {string} templatesDir
 * @param {AssetSpec[]} assets
 */
export function assertHookTemplatesInCatalog(templatesDir, assets) {
  const hooksDir = path.join(templatesDir, ".githooks");
  if (!fs.existsSync(hooksDir)) return;
  const targets = new Set(assets.map((a) => a.targetPath));
  /** @type {string[]} */
  const missing = [];
  for (const name of fs.readdirSync(hooksDir).sort((a, b) => a.localeCompare(b))) {
    const abs = path.join(hooksDir, name);
    if (!fs.statSync(abs).isFile()) continue;
    const targetPath = `.githooks/${name}`;
    if (!targets.has(targetPath)) {
      missing.push(targetPath);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `hook templates missing from generated catalog (add to STATIC_ASSETS):\n  ${missing.join("\n  ")}`,
    );
  }
}

/**
 * @param {string} templatesDir
 * @param {AssetSpec[]} assets
 */
export function assertTemplateFilesExist(templatesDir, assets) {
  /** @type {string[]} */
  const missing = [];
  for (const asset of assets) {
    const templateRel = asset.templatePath ?? asset.targetPath;
    const templateAbs = path.join(templatesDir, templateRel.split("/").join(path.sep));
    if (!fs.existsSync(templateAbs)) {
      missing.push(templateRel);
    }
  }
  if (missing.length > 0) {
    throw new Error(`template files missing on disk:\n  ${missing.join("\n  ")}`);
  }
}

/** @param {string} filePath @param {string} content */
export function atomicWrite(filePath, content) {
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, filePath);
}
