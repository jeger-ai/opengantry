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

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATES_DIR = path.join(REPO_ROOT, "templates");
const COMPAT_PATH = path.join(TEMPLATES_DIR, "integrations/compatibility.json");
const METADATA_PATH = path.join(TEMPLATES_DIR, "integrations/asset-metadata.json");
const CATALOG_PATH = path.join(TEMPLATES_DIR, "integrations/asset-catalog.json");

/** @typedef {{ targetPath: string; mode: "scaffold_only" | "managed_strict"; tags: string[]; templatePath?: string; executable?: boolean }} AssetSpec */

/** Hand-tuned static assets — source of truth for core/skills/hooks/ci/runtime. */
const STATIC_ASSETS = [
  { targetPath: ".gitagent/foreman/MANIFEST.json", mode: "scaffold_only", tags: ["core"] },
  { targetPath: ".gitagent/foreman/BYPASS.sha256", mode: "scaffold_only", tags: ["core"] },
  { targetPath: ".gitagent/foreman/SUBSTRATE.version.json", mode: "scaffold_only", tags: ["core"] },
  { targetPath: ".gitagent/teacher/RULES.md", mode: "scaffold_only", tags: ["core"] },
  { targetPath: ".gitagent/missions/README.md", mode: "scaffold_only", tags: ["core"] },
  { targetPath: "AGENTS.md", mode: "scaffold_only", tags: ["core"] },
  { targetPath: ".gitagent/teacher/ARCHITECTURE-DISCOVERY.md", mode: "scaffold_only", tags: ["core"] },
  { targetPath: ".gitagent/teacher/ARCHITECTURE-ACCESS.md", mode: "scaffold_only", tags: ["core"] },
  { targetPath: ".gitagent/teacher/MISSION-ARCHITECT.md", mode: "scaffold_only", tags: ["core"] },
  { targetPath: "docs/ARCHITECTURE.md", mode: "scaffold_only", tags: ["core"] },
  { targetPath: ".gitagent/teacher/MISSION.schema.yaml", mode: "managed_strict", tags: ["core"] },
  { targetPath: ".gitagent/teacher/KPI-REPORT.schema.yaml", mode: "managed_strict", tags: ["core"] },
  { targetPath: ".gitagent/teacher/WORKER_LOG.template.md", mode: "managed_strict", tags: ["core"] },
  { targetPath: "scripts/validate-gxt.sh", mode: "managed_strict", executable: true, tags: ["core"] },
  { targetPath: "scripts/gxt-manifest-lib.mjs", mode: "managed_strict", executable: true, tags: ["core"] },
  { targetPath: "skills/ui.md", mode: "scaffold_only", tags: ["skill-minimal", "skill-specimen"] },
  { targetPath: "skills/logic.md", mode: "scaffold_only", tags: ["skill-minimal", "skill-specimen"] },
  { targetPath: "skills/gapman.md", mode: "scaffold_only", tags: ["skill-specimen"] },
  { targetPath: "skills/substrate.md", mode: "scaffold_only", tags: ["skill-specimen"] },
  { targetPath: ".githooks/post-checkout", mode: "managed_strict", executable: true, tags: ["hooks"] },
  { targetPath: ".githooks/pre-push", mode: "managed_strict", executable: true, tags: ["hooks"] },
  { targetPath: ".github/workflows/gxt-validate.yml", mode: "managed_strict", tags: ["ci"] },
  { targetPath: "scripts/verify-pr-missions.sh", mode: "managed_strict", executable: true, tags: ["ci"] },
  { targetPath: "scripts/gxt-runtime-env.sh", mode: "managed_strict", executable: true, tags: ["runtime"] },
  { targetPath: "scripts/gxt-resolve-mission.sh", mode: "managed_strict", executable: true, tags: ["runtime"] },
  { targetPath: "scripts/gxt-pin-mission.sh", mode: "managed_strict", executable: true, tags: ["runtime"] },
  { targetPath: "scripts/gxt-cursor-env.sh", mode: "managed_strict", executable: true, tags: ["runtime"] },
];

/** Repo-only scripts — never ship via init catalog (OpenGantry specimen dev gates). */
const REPO_ONLY_SCRIPTS = [
  "check-changed-code.sh",
  "check-import-layers.mjs",
  "check-lib-cycles.mjs",
  "dev-validate-core.sh",
  "dev-validate.sh",
  "npm-pack-check.sh",
  "validate-mcp-dogfood.mjs",
  "validate-mcp-dogfood.sh",
  "gen-asset-catalog.mjs",
  "gen-version.mjs",
];

/** @param {string} fileNameOrRel */
function isRepoOnlyScript(fileNameOrRel) {
  const base = path.basename(fileNameOrRel);
  return REPO_ONLY_SCRIPTS.includes(base);
}

const IDE_DISCOVERY_RULES = {
  cursor: { mode: "managed_strict", scanDir: ".cursor", targetPrefix: ".cursor" },
  default: { mode: "scaffold_only", scanSubdir: "integrations/{key}", templatePrefix: "integrations/{key}" },
};

/**
 * @param {string} absPath
 * @param {string} rootAbs
 */
function toPosixRelative(absPath, rootAbs) {
  const rel = path.relative(rootAbs, absPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path escapes templates root: ${absPath}`);
  }
  return rel.split(path.sep).join("/");
}

/** Path-based executable flag — never read host fs mode bits. */
function isExecutableByPath(targetPath) {
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
function listFilesSorted(dirAbs, baseRel = "") {
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
 * @param {Record<string, unknown>} compat
 * @returns {AssetSpec[]}
 */
function discoverIdeAssets(compat) {
  /** @type {AssetSpec[]} */
  const assets = [];
  const integrationKeys = Object.keys(compat.integrations).sort((a, b) => a.localeCompare(b));

  for (const key of integrationKeys) {
    if (key === "cursor") {
      const rule = IDE_DISCOVERY_RULES.cursor;
      const scanAbs = path.join(TEMPLATES_DIR, rule.scanDir);
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
    const scanAbs = path.join(TEMPLATES_DIR, scanRel.split("/").join(path.sep));
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
function formatAssetLine(asset) {
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
function formatCatalog(assets) {
  const lines = ['{', '  "schema_version": "1",', '  "assets": ['];
  for (let i = 0; i < assets.length; i++) {
    const suffix = i < assets.length - 1 ? "," : "";
    lines.push(`${formatAssetLine(assets[i])}${suffix}`);
  }
  lines.push("  ]", "}", "");
  return lines.join("\n");
}

/** @param {AssetSpec[]} assets */
function assertRepoOnlyScriptsExcluded(assets) {
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
function assertNoDuplicateTargets(assets) {
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
function assertCanonicalPathsCovered(integrations, assets) {
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

/** @param {AssetSpec[]} assets */
function assertTemplateFilesExist(assets) {
  /** @type {string[]} */
  const missing = [];
  for (const asset of assets) {
    const templateRel = asset.templatePath ?? asset.targetPath;
    const templateAbs = path.join(TEMPLATES_DIR, templateRel.split("/").join(path.sep));
    if (!fs.existsSync(templateAbs)) {
      missing.push(templateRel);
    }
  }
  if (missing.length > 0) {
    throw new Error(`template files missing on disk:\n  ${missing.join("\n  ")}`);
  }
}

/** @param {string} filePath @param {string} content */
function atomicWrite(filePath, content) {
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, filePath);
}

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
  const ideAssets = discoverIdeAssets(compat);
  const assets = [...staticAssets, ...ideAssets].sort((a, b) =>
    a.targetPath.localeCompare(b.targetPath),
  );

  assertNoDuplicateTargets(assets);
  assertRepoOnlyScriptsExcluded(assets);
  assertCanonicalPathsCovered(compat.integrations, assets);
  assertTemplateFilesExist(assets);

  const payload = formatCatalog(assets);
  atomicWrite(CATALOG_PATH, payload);
  console.log(`gen-asset-catalog: wrote ${assets.length} assets to integrations/asset-catalog.json`);
}

main();
