import fs from "node:fs";
import path from "node:path";
import { CLI_NAME } from "./constants.js";
import { logInfo } from "./cli-io.js";

function parseFragmentLines(fragmentPath: string): string[] {
  return fs
    .readFileSync(fragmentPath, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

export function mergeGxtFragment(
  repoRoot: string,
  targetFilename: string,
  templatePath: string,
  headerComment: string,
): void {
  if (!fs.existsSync(templatePath)) return;

  const fragmentLines = parseFragmentLines(templatePath);
  if (fragmentLines.length === 0) return;

  const targetPath = path.join(repoRoot, targetFilename);
  const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf8") : "";
  const existingLines = existing.split(/\r?\n/).map((l) => l.trim());
  const missingLines = fragmentLines.filter((line) => !existingLines.includes(line));
  if (missingLines.length === 0) return;

  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : existing.length > 0 ? "" : "";
  const block = `${prefix}\n${headerComment}\n${missingLines.join("\n")}\n`;
  fs.writeFileSync(targetPath, existing + block, "utf8");
  logInfo(`${CLI_NAME}: appended ${missingLines.length} line(s) to ${targetFilename}`);
}

export function mergeGitignoreFromTemplate(repoRoot: string, templatesRoot: string): void {
  mergeGxtFragment(
    repoRoot,
    ".gitignore",
    path.join(templatesRoot, ".gitignore.gxt"),
    "# OpenGantry (gantry init) — local forensic paths",
  );
}

export function mergePrettierignoreFromTemplate(repoRoot: string, templatesRoot: string): void {
  mergeGxtFragment(
    repoRoot,
    ".prettierignore",
    path.join(templatesRoot, ".prettierignore.gxt"),
    "# OpenGantry (gantry init) — keep EXECUTOR_LOG line numbers stable for trace mapping",
  );
}
