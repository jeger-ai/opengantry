import path from "node:path";

export function suggestSkillKeyFromFolder(folderRel: string): string {
  const base = path.basename(folderRel.replace(/\/$/, ""));
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "skill";
}
