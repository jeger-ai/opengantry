import fs from "node:fs";
import path from "node:path";
import { IDE_DISCOVERY_RULES, isRepoOnlyScript } from "./asset-catalog-static.mjs";

/** @typedef {{ targetPath: string; mode: "scaffold_only" | "managed_strict"; tags: string[]; templatePath?: string; executable?: boolean }} AssetSpec */

/**
 * @param {string} absPath
 * @param {string} rootAbs
 */
export function toPosixRelative(absPath, rootAbs) {
  const rel = path.relative(rootAbs, absPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path escapes templates root: ${absPath}`);
  }
  return rel.split(path.sep).join("/");
}

/** Path-based executable flag — never read host fs mode bits. */
export function isExecutableByPath(targetPath) {
  if (targetPath.endsWith(".sh")) return true;
  if (targetPath.endsWith(".mjs") && targetPath.startsWith("scripts/")) return true;
  if (targetPath.startsWith(".githooks/")) return true;
  return false;
}

/**
 * @param {string} dirAbs
 * @param {string} baseRel
 * @returns {string[]}
 */
export function listFilesSorted(dirAbs, baseRel = "") {
  if (!fs.existsSync(dirAbs)) return [];
  /** @type {string[]} */
  const out = [];
  const entries = fs.readdirSync(dirAbs).sort((a, b) => a.localeCompare(b));
  for (const name of entries) {
    if (isRepoOnlyScript(name)) continue;
    const abs = path.join(dirAbs, name);
    const rel = baseRel ? `${baseRel}/${name}` : name;
    if (isRepoOnlyScript(rel)) continue;
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      out.push(...listFilesSorted(abs, rel));
    } else if (stat.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * @param {string} templatesDir
 * @param {Record<string, unknown>} compat
 * @returns {AssetSpec[]}
 */
export function discoverIdeAssets(templatesDir, compat) {
  /** @type {AssetSpec[]} */
  const assets = [];
  const integrationKeys = Object.keys(compat.integrations).sort((a, b) => a.localeCompare(b));

  for (const key of integrationKeys) {
    if (key === "cursor") {
      const rule = IDE_DISCOVERY_RULES.cursor;
      const scanAbs = path.join(templatesDir, rule.scanDir);
      for (const fileRel of listFilesSorted(scanAbs)) {
        const targetPath = `${rule.targetPrefix}/${fileRel}`;
        /** @type {AssetSpec} */
        const asset = {
          targetPath,
          mode: rule.mode,
          tags: [key],
        };
        if (isExecutableByPath(targetPath)) asset.executable = true;
        assets.push(asset);
      }
      continue;
    }

    const rule = IDE_DISCOVERY_RULES.default;
    const scanRel = rule.scanSubdir.replace("{key}", key);
    const scanAbs = path.join(templatesDir, scanRel.split("/").join(path.sep));
    for (const fileRel of listFilesSorted(scanAbs)) {
      const templatePath = `${rule.templatePrefix.replace("{key}", key)}/${fileRel}`;
      /** @type {AssetSpec} */
      const asset = {
        targetPath: fileRel,
        templatePath,
        mode: rule.mode,
        tags: [key],
      };
      if (isExecutableByPath(fileRel)) asset.executable = true;
      assets.push(asset);
    }
  }

  return assets;
}

/** @param {AssetSpec} asset */
export function formatAssetLine(asset) {
  const parts = [`"targetPath": ${JSON.stringify(asset.targetPath)}`];
  if (asset.templatePath !== undefined) {
    parts.push(`"templatePath": ${JSON.stringify(asset.templatePath)}`);
  }
  parts.push(`"mode": ${JSON.stringify(asset.mode)}`);
  if (asset.executable) {
    parts.push(`"executable": true`);
  }
  parts.push(`"tags": [${asset.tags.map((t) => JSON.stringify(t)).join(", ")}]`);
  return `    { ${parts.join(", ")} }`;
}

/** @param {AssetSpec[]} assets */
export function formatCatalog(assets) {
  const lines = ['{', '  "schema_version": "1",', '  "assets": ['];
  for (let i = 0; i < assets.length; i++) {
    const suffix = i < assets.length - 1 ? "," : "";
    lines.push(`${formatAssetLine(assets[i])}${suffix}`);
  }
  lines.push("  ]", "}", "");
  return lines.join("\n");
}
