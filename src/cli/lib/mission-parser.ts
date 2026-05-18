import fs from "node:fs";
import path from "node:path";
import { extractMsnIdFromMissionBody } from "./mission-msn.js";
import { parseMarkdownMission } from "./mission-markdown.js";
import { validateYamlMission } from "./mission-yaml.js";
import type { ParsedMission } from "./types.js";

export { parseMarkdownMission, isMarkdownTableSeparatorRow } from "./mission-markdown.js";
export { validateYamlMission, ensureMissionSchemaFileExists } from "./mission-yaml.js";

export function parseMissionFile(root: string, filePath: string): ParsedMission {
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  const body = fs.readFileSync(absolute, "utf8");
  const ext = path.extname(absolute).toLowerCase();
  const mission =
    ext === ".yaml" || ext === ".yml"
      ? validateYamlMission(root, absolute, body)
      : parseMarkdownMission(absolute, body);
  const proofMsn = extractMsnIdFromMissionBody(body, ext);
  if (proofMsn) {
    return { ...mission, msnId: proofMsn };
  }
  return mission;
}

export function assertMissionGatePresent(mission: ParsedMission): void {
  if (!mission.gate?.command?.trim()) {
    throw new Error(`gapman mission: no deterministic gate (Command) found in ${mission.rawPath}`);
  }
}
