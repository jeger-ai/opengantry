import YAML from "yaml";
import { canonicalJson } from "./canonical-json.js";
import {
  REL_ARCHITECTURE_POINTER_JSON,
  REL_ARCHITECTURE_POINTER_YAML,
  REL_GXT_CONFIG_JSON,
  REL_GXT_CONFIG_YAML,
  REL_MANIFEST_JSON,
  REL_MANIFEST_YAML,
  REL_POLICY_POINTER_JSON,
  REL_POLICY_POINTER_YAML,
} from "./constants.js";
import { GXT_ERROR } from "./error-codes.js";
import { EXIT_CODE } from "./exit-codes.js";
import { parseStrictYaml } from "./strict-yaml.js";
import { GantryUserError } from "./user-error.js";

/**
 * The law files humans write, during their ADR-0047 §4 migration: the YAML form is read first, the 3.x JSON form
 * when the YAML form is absent, and both present must be the same document (GXT_LAW_FILE_AMBIGUOUS otherwise).
 * Pure: callers supply the texts, from the working tree or from a git revision.
 */
export type LawFileId = "manifest" | "config" | "architecture-pointer" | "policy-pointer";

export interface LawFile {
  /** Also the `gantry migrate <id>` verb. */
  id: LawFileId;
  /** Repository-relative path of the YAML form. */
  yaml: string;
  /** Repository-relative path of the 3.x JSON form. */
  json: string;
  /** What the file is, for the comment header of the YAML form. */
  purpose: string;
}

export const LAW_FILES: Readonly<Record<LawFileId, LawFile>> = {
  manifest: {
    id: "manifest",
    yaml: REL_MANIFEST_YAML,
    json: REL_MANIFEST_JSON,
    purpose: "OpenGantry manifest: the Level-1 law file (skills, edit roots, forbidden zones, risk tiers).",
  },
  config: {
    id: "config",
    yaml: REL_GXT_CONFIG_YAML,
    json: REL_GXT_CONFIG_JSON,
    purpose: "OpenGantry config: Planner-owned switches (signature tiers, telemetry, the ledger, trusted automation).",
  },
  "architecture-pointer": {
    id: "architecture-pointer",
    yaml: REL_ARCHITECTURE_POINTER_YAML,
    json: REL_ARCHITECTURE_POINTER_JSON,
    purpose: "OpenGantry architecture pointer: where agents find the code layout (kind: file | directory | external | unset).",
  },
  "policy-pointer": {
    id: "policy-pointer",
    yaml: REL_POLICY_POINTER_YAML,
    json: REL_POLICY_POINTER_JSON,
    purpose:
      "OpenGantry org policy pointer: the tracked pin of a signed org policy repository (gantry policy pull fills pinned_commit and bundle_sha256).",
  },
};

export type LawFileKind = "yaml" | "json";

export interface LawFileSource {
  rel: string;
  kind: LawFileKind;
  text: string;
}

/** A repository-relative path's text, or null when the file is absent. */
export type ReadRepoText = (rel: string) => string | null;

/** The document as written: strict YAML or JSON. */
export function parseLawFileDocument(source: LawFileSource): unknown {
  return source.kind === "yaml" ? parseStrictYaml(source.text) : JSON.parse(source.text);
}

/** Pick the authoritative form from the texts found (null = absent); null when neither exists. */
export function selectLawFileSource(file: LawFile, yaml: string | null, json: string | null): LawFileSource | null {
  if (yaml === null && json === null) return null;
  if (yaml !== null && json !== null) {
    const a = canonicalJson(parseLawFileDocument({ rel: file.yaml, kind: "yaml", text: yaml }));
    const b = canonicalJson(parseLawFileDocument({ rel: file.json, kind: "json", text: json }));
    if (a !== b) {
      throw new GantryUserError(
        GXT_ERROR.LAW_FILE_AMBIGUOUS,
        `${file.yaml} and ${file.json} both exist and differ; keep one`,
        `gantry migrate ${file.id} writes the YAML form from the JSON form and removes the JSON form`,
        EXIT_CODE.USAGE,
      );
    }
  }
  return yaml !== null ? { rel: file.yaml, kind: "yaml", text: yaml } : { rel: file.json, kind: "json", text: json as string };
}

/** The law file as the reader sees it: the working tree, a git revision, a test fixture. */
export function readLawFile(file: LawFile, read: ReadRepoText): LawFileSource | null {
  return selectLawFileSource(file, read(file.yaml), read(file.json));
}

/** The deterministic YAML form: a comment header, then the document. */
export function lawFileToYaml(file: LawFile, doc: unknown): string {
  const legacy = file.json.split("/").at(-1);
  const header = [file.purpose, `Humans write YAML (ADR-0047). The CLI reads this file; the 3.x ${legacy} is read only when this file is absent.`];
  return header.map((line) => `# ${line}`).join("\n") + "\n\n" + YAML.stringify(doc, { lineWidth: 0 });
}
