import fs from "node:fs";
import path from "node:path";

export function emitActiveMissionFromTemplate(
  root: string,
  opts: { skillKey: string; msnId: string; outPath?: string },
): string {
  const tpl = path.join(root, ".gitagent/teacher/MISSION.template.md");
  if (!fs.existsSync(tpl)) throw new Error(`gapman: missing mission template ${tpl}`);
  let body = fs.readFileSync(tpl, "utf8");
  body = body.replace(/\[MSN-XXXX\]/g, opts.msnId);
  body = body.replace(
    /- \*\*Skill key:\*\* \[e\.g\. `[^`]+` \| `[^`]+`\]/,
    `- **Skill key:** \`${opts.skillKey}\``,
  );
  const out = opts.outPath
    ? path.isAbsolute(opts.outPath)
      ? opts.outPath
      : path.join(root, opts.outPath)
    : path.join(root, "ACTIVE_MISSION.md");
  fs.writeFileSync(out, body, "utf8");
  return out;
}
