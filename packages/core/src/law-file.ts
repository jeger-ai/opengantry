import YAML from "yaml";
import { canonicalJson } from "./canonical-json.js";
import { GXT_ERROR } from "./error-codes.js";
import { EXIT_CODE } from "./exit-codes.js";
import { parseStrictYaml } from "./strict-yaml.js";
import { GantryUserError } from "./user-error.js";

/**
 * A law file humans write, during its ADR-0047 §4 migration: the YAML form is read first, the 3.x JSON form when
 * the YAML form is absent, and both present must be the same document (GXT_LAW_FILE_AMBIGUOUS otherwise).
 * Pure: callers read the texts (from the working tree or from a git revision).
 */
export type LawFileKind = "yaml" | "json";

export interface LawFilePair {
  /** Repository-relative path of the YAML form. */
  yaml: string;
  /** Repository-relative path of the 3.x JSON form. */
  json: string;
  /** The `gantry migrate <name>` verb that converts the JSON form. */
  migrate: string;
}

export interface LawFileSource {
  rel: string;
  kind: LawFileKind;
  text: string;
}

/** The document as written: strict YAML or JSON. */
export function parseLawFileDocument(source: LawFileSource): unknown {
  return source.kind === "yaml" ? parseStrictYaml(source.text) : JSON.parse(source.text);
}

/** Pick the authoritative form from the texts found (null = file absent); null when neither exists. */
export function selectLawFileSource(pair: LawFilePair, yaml: string | null, json: string | null): LawFileSource | null {
  if (yaml === null && json === null) return null;
  if (yaml !== null && json !== null) {
    const a = canonicalJson(parseLawFileDocument({ rel: pair.yaml, kind: "yaml", text: yaml }));
    const b = canonicalJson(parseLawFileDocument({ rel: pair.json, kind: "json", text: json }));
    if (a !== b) {
      throw new GantryUserError(
        GXT_ERROR.LAW_FILE_AMBIGUOUS,
        `${pair.yaml} and ${pair.json} both exist and differ; keep one`,
        `gantry migrate ${pair.migrate} writes the YAML form from the JSON form and removes the JSON form`,
        EXIT_CODE.USAGE,
      );
    }
  }
  return yaml !== null ? { rel: pair.yaml, kind: "yaml", text: yaml } : { rel: pair.json, kind: "json", text: json as string };
}

/** The deterministic YAML form: a comment header, then the document. */
export function lawFileToYaml(header: readonly string[], doc: unknown): string {
  return header.map((line) => `# ${line}`).join("\n") + "\n\n" + YAML.stringify(doc, { lineWidth: 0 });
}
