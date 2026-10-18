import { REL_MANIFEST_JSON, REL_MANIFEST_YAML } from "./constants.js";
import { lawFileToYaml, parseLawFileDocument, selectLawFileSource, type LawFilePair, type LawFileSource } from "./law-file.js";
import { validateManifestShape, type Manifest } from "./manifest.js";

/**
 * The manifest on disk (ADR-0047 §4, ADR-0052 A6): `.gitagent/foreman/MANIFEST.yaml` is the form humans write
 * since 4.0; the 3.x `MANIFEST.json` is still read when the YAML form is absent (law-file.ts).
 */
export type ManifestFileKind = LawFileSource["kind"];
export type ManifestSource = LawFileSource;

export const MANIFEST_FILES: LawFilePair = { yaml: REL_MANIFEST_YAML, json: REL_MANIFEST_JSON, migrate: "manifest" };

/** The read order: the YAML form first. */
export const MANIFEST_READ_ORDER: readonly { rel: string; kind: ManifestFileKind }[] = [
  { rel: REL_MANIFEST_YAML, kind: "yaml" },
  { rel: REL_MANIFEST_JSON, kind: "json" },
];

/** The document as written, not validated (advisory readers). */
export function parseManifestDocument(source: ManifestSource): unknown {
  return parseLawFileDocument(source);
}

export function parseManifestSource(source: ManifestSource): Manifest {
  const raw = parseManifestDocument(source);
  validateManifestShape(raw);
  return raw;
}

/** Pick the authoritative form from the texts found (null = file absent); null when neither exists. */
export function selectManifestSource(yaml: string | null, json: string | null): ManifestSource | null {
  return selectLawFileSource(MANIFEST_FILES, yaml, json);
}

const YAML_HEADER = [
  "OpenGantry manifest: the Level-1 law file (skills, edit roots, forbidden zones, risk tiers).",
  "Humans write YAML (ADR-0047). The CLI reads this file; the 3.x MANIFEST.json is read only when this file is absent.",
];

/** The deterministic YAML form of a manifest (what `gantry migrate manifest` and discovery write). */
export function manifestToYaml(manifest: Manifest): string {
  return lawFileToYaml(YAML_HEADER, manifest);
}
