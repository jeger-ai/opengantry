import fs from "node:fs";
import path from "node:path";
import { CLI_NAME } from "./constants.js";
import { logInfo } from "./cli-io.js";

export function mergeGitignoreFromTemplate(repoRoot: string, templatesRoot: string): void {
  const fragmentPath = path.join(templatesRoot, ".gitignore.gxt");
  if (!fs.existsSync(fragmentPath)) return;

  const lines = fs
    .readFileSync(fragmentPath, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  const gitignorePath = path.join(repoRoot, ".gitignore");
  const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";
  const missing = lines.filter((line) => !existing.includes(line));
  if (missing.length === 0) return;

  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : existing.length > 0 ? "" : "";
  const block = `${prefix}\n# OpenGantry (gapman init)\n${missing.join("\n")}\n`;
  fs.writeFileSync(gitignorePath, existing + block, "utf8");
  logInfo(`${CLI_NAME}: appended ${missing.length} line(s) to .gitignore`);
}
