import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLI_NAME } from "../lib/constants.js";
import { formatRepoRelative, logError, logInfo, setExitCode } from "../lib/cli-io.js";
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

  const examples = [
    ".gitagent/foreman/MANIFEST.json",
    ".gitagent/teacher/RULES.md",
    ".github/workflows/gxt-validate.yml",
  ];
  for (const rel of examples) {
    const abs = path.join(repoRoot, rel.split("/").join(path.sep));
    if (fs.existsSync(abs)) {
      logInfo(`- ${formatRepoRelative(repoRoot, abs)}`);
    }
  }
}
