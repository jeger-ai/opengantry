import { CLI_NAME, REL_MANIFEST_JSON, REL_MANIFEST_YAML } from "#core/constants.js";
import { parseLawFileDocument } from "#core/law-file.js";
import { parseManifestSource, type Manifest } from "#core/manifest.js";
import { readLawFileAt } from "#git/repo-text.js";

export function manifestExists(root: string): boolean {
  return readLawFileAt(root, "manifest") !== null;
}

export function loadManifest(root: string): Manifest {
  const source = readLawFileAt(root, "manifest");
  if (!source) {
    throw new Error(`${CLI_NAME}: missing ${REL_MANIFEST_YAML} (or the 3.x ${REL_MANIFEST_JSON})`);
  }
  return parseManifestSource(source);
}

/** The manifest document as written, unvalidated; null when missing or unparseable (advisory readers). */
export function readManifestDocument(root: string): unknown | null {
  try {
    const source = readLawFileAt(root, "manifest");
    return source ? parseLawFileDocument(source) : null;
  } catch {
    return null;
  }
}
