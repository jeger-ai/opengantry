import { REL_POLICY_POINTER_JSON, REL_POLICY_POINTER_YAML } from "./constants.js";
import { lawFileToYaml, selectLawFileSource, type LawFilePair, type LawFileSource } from "./law-file.js";

/** `.gitagent/foreman/POLICY.pointer` on disk: the YAML form first, the 3.x JSON form as the fallback (ADR-0047 §4). */
export const POLICY_POINTER_FILES: LawFilePair = {
  yaml: REL_POLICY_POINTER_YAML,
  json: REL_POLICY_POINTER_JSON,
  migrate: "policy-pointer",
};

export function selectPolicyPointerSource(yaml: string | null, json: string | null): LawFileSource | null {
  return selectLawFileSource(POLICY_POINTER_FILES, yaml, json);
}

const YAML_HEADER = [
  "OpenGantry org policy pointer: the tracked pin of a signed org policy repository (gantry policy pull fills pinned_commit and bundle_sha256).",
  "Humans write YAML (ADR-0047). The CLI reads this file; the 3.x POLICY.pointer.json is read only when this file is absent.",
];

export function policyPointerToYaml(pointer: unknown): string {
  return lawFileToYaml(YAML_HEADER, pointer);
}
