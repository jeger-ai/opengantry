import path from "node:path";
import { CLI_NAME, REL_MANIFEST_JSON, REL_MANIFEST_YAML } from "#core/constants.js";
import { parseLawFileDocument, type LawFileSource } from "#core/law-file.js";
import { parseManifestSource, type Manifest } from "#core/manifest.js";
import { lawFileRelAt, readLawFileAt } from "./law-files.js";

/** The manifest on disk: the YAML form, else the 3.x JSON form; null when neither exists (ADR-0047 dual-read). */
export function readManifestSource(root: string): LawFileSource | null {
  return readLawFileAt(root, "manifest");
}

export function manifestExists(root: string): boolean {
  return readManifestSource(root) !== null;
}

/** Repository-relative path of the authoritative manifest; the YAML path when none exists yet (what init writes). */
export function manifestRelPath(root: string): string {
  return lawFileRelAt(root, "manifest");
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
    return source ? parseLawFileDocument(source) : null;
  } catch {
    return null;
  }
}
