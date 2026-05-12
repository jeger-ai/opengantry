import fs from "node:fs";
import path from "node:path";
import type { Manifest } from "./types.js";

const SKILLS_DIR = "skills";

export interface SkillSyncResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifestKeys: string[];
  diskFiles: string[];
}

/** Rule 4.4: every manifest skill key must have skills/<key>.md; no orphan skill files */
export function checkSkillManifestSync(root: string, manifest: Manifest): SkillSyncResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const manifestKeys = Object.keys(manifest.skills).sort();
  const dir = path.join(root, SKILLS_DIR);

  if (!fs.existsSync(dir)) {
    for (const k of manifestKeys) {
      errors.push(`Missing ${SKILLS_DIR}/ directory; expected ${SKILLS_DIR}/${k}.md`);
    }
    return { ok: false, errors, warnings, manifestKeys, diskFiles: [] };
  }

  const diskFiles = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .sort();

  for (const k of manifestKeys) {
    const fp = path.join(dir, `${k}.md`);
    if (!fs.existsSync(fp)) {
      errors.push(`Rule 4.4: manifest skill "${k}" has no definition file ${SKILLS_DIR}/${k}.md`);
    }
  }

  for (const f of diskFiles) {
    if (!manifestKeys.includes(f)) {
      errors.push(`Rule 4.4: orphan skill file ${SKILLS_DIR}/${f}.md (no matching manifest.skills["${f}"])`);
    }
  }

  return { ok: errors.length === 0, errors, warnings, manifestKeys, diskFiles };
}
