import YAML from "yaml";
import { canonicalJson } from "./canonical-json.js";
import { REL_MANIFEST_JSON, REL_MANIFEST_YAML } from "./constants.js";
import { GXT_ERROR } from "./error-codes.js";
import { EXIT_CODE } from "./exit-codes.js";
import { validateManifestShape, type Manifest } from "./manifest.js";
import { parseStrictYaml } from "./strict-yaml.js";
import { GantryUserError } from "./user-error.js";

/**
 * The manifest on disk (ADR-0047 §4, ADR-0052 A6): `.gitagent/foreman/MANIFEST.yaml` is the form humans write
 * since 4.0; the 3.x `MANIFEST.json` is still read when the YAML form is absent. When both exist they must be
 * the same document, otherwise reading fails closed with GXT_MANIFEST_AMBIGUOUS. Pure: callers read the texts.
 */
export type ManifestFileKind = "yaml" | "json";

export interface ManifestSource {
  rel: string;
  kind: ManifestFileKind;
  text: string;
}

/** The read order: the YAML form first. */
export const MANIFEST_READ_ORDER: readonly { rel: string; kind: ManifestFileKind }[] = [
  { rel: REL_MANIFEST_YAML, kind: "yaml" },
  { rel: REL_MANIFEST_JSON, kind: "json" },
];

/** The document as written, not validated (advisory readers). */
export function parseManifestDocument(source: ManifestSource): unknown {
  return source.kind === "yaml" ? parseStrictYaml(source.text) : JSON.parse(source.text);
}

export function parseManifestSource(source: ManifestSource): Manifest {
  const raw = parseManifestDocument(source);
  validateManifestShape(raw);
  return raw;
}

/** Pick the authoritative form from the texts found (null = file absent); null when neither exists. */
export function selectManifestSource(yaml: string | null, json: string | null): ManifestSource | null {
  if (yaml === null && json === null) return null;
  if (yaml !== null && json !== null) {
    const a = canonicalJson(parseManifestSource({ rel: REL_MANIFEST_YAML, kind: "yaml", text: yaml }));
    const b = canonicalJson(parseManifestSource({ rel: REL_MANIFEST_JSON, kind: "json", text: json }));
    if (a !== b) {
      throw new GantryUserError(
        GXT_ERROR.MANIFEST_AMBIGUOUS,
        `${REL_MANIFEST_YAML} and ${REL_MANIFEST_JSON} both exist and differ; keep one`,
        "gantry migrate manifest writes the YAML form from the JSON form and removes the JSON form",
        EXIT_CODE.USAGE,
      );
    }
  }
  return yaml !== null
    ? { rel: REL_MANIFEST_YAML, kind: "yaml", text: yaml }
    : { rel: REL_MANIFEST_JSON, kind: "json", text: json as string };
}

const YAML_HEADER = [
  "# OpenGantry manifest: the Level-1 law file (skills, edit roots, forbidden zones, risk tiers).",
  "# Humans write YAML (ADR-0047). The CLI reads this file; the 3.x MANIFEST.json is read only when this file is absent.",
  "",
].join("\n");

/** The deterministic YAML form of a manifest (what `gantry migrate manifest` and discovery write). */
export function manifestToYaml(manifest: Manifest): string {
  return YAML_HEADER + YAML.stringify(manifest, { lineWidth: 0 });
}
