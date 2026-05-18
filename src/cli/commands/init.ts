import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLI_NAME } from "../lib/constants.js";
import { logError, logInfo, setExitCode } from "../lib/cli-io.js";
import { getRepoRoot } from "../lib/git.js";
import { INIT_ASSETS } from "../lib/init-assets.js";
import {
  applyInitWrites,
  logInitNextSteps,
  logInitSummary,
  planInitAssets,
} from "../lib/init-plan.js";

export interface InitOptions {
  force?: boolean;
  cwd?: string;
}

function resolveTemplateRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(moduleDir, "../../../templates");
  if (fs.existsSync(root)) return root;
  throw new Error(`${CLI_NAME} init: missing templates directory at ${root}`);
}

function mergeGitignoreFromTemplate(repoRoot: string, templatesRoot: string): void {
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
  logInfo(`${CLI_NAME} init: appended ${missing.length} line(s) to .gitignore`);
}

export function runInit(options: InitOptions = {}): void {
  let repoRoot: string;
  try {
    repoRoot = getRepoRoot(options.cwd);
  } catch (e) {
    logError(e instanceof Error ? e.message.replace(`${CLI_NAME}: `, "") : String(e));
    setExitCode(2);
    return;
  }

  let templatesRoot: string;
  try {
    templatesRoot = resolveTemplateRoot();
  } catch (e) {
    logError(e instanceof Error ? e.message : String(e));
    setExitCode(2);
    return;
  }

  const plan = planInitAssets([...INIT_ASSETS], templatesRoot, repoRoot, options.force === true);
  if (!plan.ok) {
    setExitCode(2);
    return;
  }
  if (plan.conflicts.length > 0) {
    logError("init: managed asset conflicts detected:");
    for (const rel of plan.conflicts) logError(`  - ${rel}`);
    logError("re-run with --force to overwrite managed assets");
    setExitCode(2);
    return;
  }

  applyInitWrites(plan.writes);
  logInitSummary(plan.writes, plan.skippedUserMutable, plan.unchanged);
  logInitNextSteps();
  mergeGitignoreFromTemplate(repoRoot, templatesRoot);
}
