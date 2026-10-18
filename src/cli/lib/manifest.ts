import fs from "node:fs";
import path from "node:path";
import { CLI_NAME } from "./constants.js";
import { REL_MANIFEST_JSON, REL_MANIFEST_YAML } from "#core/constants.js";
import {
  manifestToYaml,
  parseManifestDocument,
  parseManifestSource,
  selectManifestSource,
  type ManifestSource,
} from "#core/manifest-file.js";
import type { Manifest } from "#core/manifest.js";
export { validateManifestShape } from "#core/manifest.js";

function readText(root: string, rel: string): string | null {
  const abs = path.join(root, ...rel.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

/** The manifest on disk: the YAML form, else the 3.x JSON form; null when neither exists (ADR-0047 dual-read). */
export function readManifestSource(root: string): ManifestSource | null {
  return selectManifestSource(readText(root, REL_MANIFEST_YAML), readText(root, REL_MANIFEST_JSON));
}

export function manifestExists(root: string): boolean {
  return readManifestSource(root) !== null;
}

/** Repository-relative path of the authoritative manifest; the YAML path when none exists yet (what init writes). */
export function manifestRelPath(root: string): string {
  return readManifestSource(root)?.rel ?? REL_MANIFEST_YAML;
}

export function manifestPath(root: string): string {
  return path.join(root, ...manifestRelPath(root).split("/"));
}

export function loadManifest(root: string): Manifest {
  const source = readManifestSource(root);
  if (!source) {
    throw new Error(`${CLI_NAME}: missing ${REL_MANIFEST_YAML} (or the 3.x ${REL_MANIFEST_JSON})`);
  }
  return parseManifestSource(source);
}

/** The manifest document as written, unvalidated; null when missing or unparseable (advisory readers). */
export function readManifestDocument(root: string): unknown | null {
  try {
    const source = readManifestSource(root);
    return source ? parseManifestDocument(source) : null;
  } catch {
    return null;
  }
}

/** The manifest, or null when it is missing or invalid (advisory readers). */
export function readManifestOrNull(root: string): Manifest | null {
  try {
    return loadManifest(root);
  } catch {
    return null;
  }
}

/** Write the YAML form; returns its absolute path. */
export function writeManifestYaml(root: string, manifest: Manifest): string {
  const abs = path.join(root, ...REL_MANIFEST_YAML.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, manifestToYaml(manifest), "utf8");
  return abs;
}
