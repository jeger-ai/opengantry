import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLI_NAME } from "../lib/constants.js";
import { logError, logInfo, setExitCode } from "../lib/cli-io.js";
import { getRepoRoot } from "../lib/git.js";
import { INIT_ASSETS } from "../lib/init-assets.js";

export interface InitOptions {
  force?: boolean;
  cwd?: string;
}

interface PlannedWrite {
  absoluteTarget: string;
  body: string;
  executable: boolean;
}

function resolveTemplateRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(moduleDir, "../../../templates");
  if (fs.existsSync(root)) return root;
  throw new Error(`${CLI_NAME} init: missing templates directory at ${root}`);
}

function readUtf8IfExists(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
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

  const writes: PlannedWrite[] = [];
  const conflicts: string[] = [];
  const skippedUserMutable: string[] = [];
  const unchanged: string[] = [];

  for (const asset of INIT_ASSETS) {
    const templateAbs = path.join(templatesRoot, asset.targetPath.split("/").join(path.sep));
    const targetAbs = path.join(repoRoot, asset.targetPath.split("/").join(path.sep));
    const body = readUtf8IfExists(templateAbs);
    if (body === null) {
      logError(`init: missing template for ${asset.targetPath} at ${templateAbs}`);
      setExitCode(2);
      return;
    }

    const existing = readUtf8IfExists(targetAbs);
    if (existing === null) {
      writes.push({ absoluteTarget: targetAbs, body, executable: asset.executable === true });
      continue;
    }

    if (existing === body) {
      unchanged.push(asset.targetPath);
      continue;
    }

    if (asset.mode === "scaffold_only") {
      skippedUserMutable.push(asset.targetPath);
      continue;
    }

    if (options.force === true) {
      writes.push({ absoluteTarget: targetAbs, body, executable: asset.executable === true });
      continue;
    }

    conflicts.push(asset.targetPath);
  }

  if (conflicts.length > 0) {
    logError("init: managed asset conflicts detected:");
    for (const rel of conflicts) {
      logError(`  - ${rel}`);
    }
    logError("re-run with --force to overwrite managed assets");
    setExitCode(2);
    return;
  }

  for (const w of writes) {
    fs.mkdirSync(path.dirname(w.absoluteTarget), { recursive: true });
    fs.writeFileSync(w.absoluteTarget, w.body, "utf8");
    if (w.executable) {
      fs.chmodSync(w.absoluteTarget, 0o755);
    }
  }

  logInfo(`${CLI_NAME} init: wrote ${writes.length} files`);
  if (skippedUserMutable.length > 0) {
    logInfo(`${CLI_NAME} init: preserved ${skippedUserMutable.length} existing user-managed files`);
  }
  if (unchanged.length > 0) {
    logInfo(`${CLI_NAME} init: ${unchanged.length} files already up to date`);
  }

  logInfo("next steps:");
  logInfo(
    "1) edit .gitagent/foreman/MANIFEST.json (tmvc_roots, forbidden_zones, skills) and run `gapman check`",
  );
  logInfo("2) optional: git config core.hooksPath .githooks");
  logInfo("3) export GAPMAN_TEACHER_EMAILS=<your-git-email>");
  logInfo(
    '4) legislate only after manifest skill keys exist: gapman legislate "<intent>" --msn MSN-0001 --skill-key <manifest-key>',
  );
  logInfo("5) Teacher commit must start with [MSN-0001] and modify that mission file");
  logInfo("6) run gapman runtime env --mission <path> then gapman verify --mission <path>");
  logInfo(
    "7) this repo has .gitagent/missions/example.verify.yaml; greenfield repos can start from .gitagent/missions/README.md",
  );

  mergeGitignoreFromTemplate(repoRoot, templatesRoot);
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
