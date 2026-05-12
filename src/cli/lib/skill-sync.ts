import fs from "node:fs";
import path from "node:path";
import { SKILLS_DIR_NAME } from "./constants.js";
import type { Manifest } from "./types.js";

export interface SkillSyncResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifestKeys: string[];
  diskFiles: string[];
}

function listSkillKeysFromDisk(skillsDir: string): string[] {
  if (!fs.existsSync(skillsDir)) return [];
  return fs
    .readdirSync(skillsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .sort();
}

/** Rule 4.4: every manifest skill key must have skills/<key>.md; no orphan skill files */
export function checkSkillManifestSync(root: string, manifest: Manifest): SkillSyncResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const manifestKeys = Object.keys(manifest.skills).sort();
  const dir = path.join(root, SKILLS_DIR_NAME);

  if (!fs.existsSync(dir)) {
    for (const k of manifestKeys) {
      errors.push(`Missing ${SKILLS_DIR_NAME}/ directory; expected ${SKILLS_DIR_NAME}/${k}.md`);
    }
    return { ok: false, errors, warnings, manifestKeys, diskFiles: [] };
  }

  const diskFiles = listSkillKeysFromDisk(dir);

  for (const k of manifestKeys) {
    const fp = path.join(dir, `${k}.md`);
    if (!fs.existsSync(fp)) {
      errors.push(
        `Rule 4.4: manifest skill "${k}" has no definition file ${SKILLS_DIR_NAME}/${k}.md`,
      );
    }
  }

  for (const f of diskFiles) {
    if (!manifestKeys.includes(f)) {
      errors.push(
        `Rule 4.4: orphan skill file ${SKILLS_DIR_NAME}/${f}.md (no matching manifest.skills["${f}"])`,
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings, manifestKeys, diskFiles };
}
