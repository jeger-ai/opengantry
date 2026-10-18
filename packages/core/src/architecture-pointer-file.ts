import { REL_ARCHITECTURE_POINTER_JSON, REL_ARCHITECTURE_POINTER_YAML } from "./constants.js";
import { lawFileToYaml, selectLawFileSource, type LawFilePair, type LawFileSource } from "./law-file.js";

/** `.gitagent/ARCHITECTURE.pointer` on disk: the YAML form first, the 3.x JSON form as the fallback (ADR-0047 §4). */
export const ARCHITECTURE_POINTER_FILES: LawFilePair = {
  yaml: REL_ARCHITECTURE_POINTER_YAML,
  json: REL_ARCHITECTURE_POINTER_JSON,
  migrate: "architecture-pointer",
};

export function selectArchitecturePointerSource(yaml: string | null, json: string | null): LawFileSource | null {
  return selectLawFileSource(ARCHITECTURE_POINTER_FILES, yaml, json);
}

const YAML_HEADER = [
  "OpenGantry architecture pointer: where agents find the code layout (kind: file | directory | external | unset).",
  "Humans write YAML (ADR-0047). The CLI reads this file; the 3.x ARCHITECTURE.pointer.json is read only when this file is absent.",
];

export function architecturePointerToYaml(pointer: unknown): string {
  return lawFileToYaml(YAML_HEADER, pointer);
}
