import { REL_GXT_CONFIG_JSON, REL_GXT_CONFIG_YAML } from "./constants.js";
import { parseGxtConfigDocument, type GxtConfigShape } from "./config.js";
import { lawFileToYaml, parseLawFileDocument, selectLawFileSource, type LawFilePair, type LawFileSource } from "./law-file.js";

/** `.gitagent/config` on disk: the YAML form first, the 3.x JSON form as the fallback (ADR-0047 §4). */
export const GXT_CONFIG_FILES: LawFilePair = { yaml: REL_GXT_CONFIG_YAML, json: REL_GXT_CONFIG_JSON, migrate: "config" };

export function selectGxtConfigSource(yaml: string | null, json: string | null): LawFileSource | null {
  return selectLawFileSource(GXT_CONFIG_FILES, yaml, json);
}

/** The config shape; a broken file is an empty config, as before. */
export function parseGxtConfigSource(source: LawFileSource): GxtConfigShape {
  try {
    return parseGxtConfigDocument(parseLawFileDocument(source));
  } catch {
    return {};
  }
}

const YAML_HEADER = [
  "OpenGantry config: Planner-owned switches (signature tiers, telemetry, the ledger, trusted automation).",
  "Humans write YAML (ADR-0047). The CLI reads this file; the 3.x config.json is read only when this file is absent.",
];

export function gxtConfigToYaml(config: GxtConfigShape): string {
  return lawFileToYaml(YAML_HEADER, config);
}
