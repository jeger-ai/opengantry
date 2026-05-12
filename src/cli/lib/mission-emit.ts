import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_ACTIVE_MISSION,
  REL_MISSION_TEMPLATE,
} from "./constants.js";

export interface EmitMissionOptions {
  skillKey: string;
  msnId: string;
  outPath?: string;
}

const SKILL_LINE_TEMPLATE_PATTERN =
  /- \*\*Skill key:\*\* \[e\.g\. `[^`]+` \| `[^`]+`\]/;

export function emitActiveMissionFromTemplate(
  repoRoot: string,
  options: EmitMissionOptions,
): string {
  const templatePath = path.join(repoRoot, REL_MISSION_TEMPLATE);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`gapman: missing mission template ${REL_MISSION_TEMPLATE}`);
  }

  let body = fs.readFileSync(templatePath, "utf8");
  body = body.replace(/\[MSN-XXXX\]/g, options.msnId);
  body = body.replace(SKILL_LINE_TEMPLATE_PATTERN, `- **Skill key:** \`${options.skillKey}\``);

  const outputPath = resolveMissionOutputPath(repoRoot, options.outPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, body, "utf8");
  return outputPath;
}

function resolveMissionOutputPath(repoRoot: string, outPath: string | undefined): string {
  if (!outPath) return path.join(repoRoot, DEFAULT_ACTIVE_MISSION);
  return path.isAbsolute(outPath) ? outPath : path.join(repoRoot, outPath);
}
