import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLI_NAME, REL_ARCHITECTURE_POINTER } from "../lib/constants.js";
import { logError, logInfo, logManagedAssetConflicts, setExitCode } from "../lib/cli-io.js";
import { getRepoRoot } from "../lib/git.js";
import { loadIntegrationCompat } from "../lib/integration-compat.js";
import { resolveAssetsFromProfile } from "../lib/init-asset-catalog.js";
import {
  composeArchitecturePointer,
  serializeArchitecturePointer,
} from "../lib/init-compose-arch-pointer.js";
import { composeIntegrationsDoc, recipeFilesExist } from "../lib/init-compose-doc.js";
import {
  defaultInitProfile,
  mergeInitProfile,
  profileFromCliFlags,
  shouldRunInteractiveWizard,
  validateIntegrationsDocPath,
  type InitProfile,
} from "../lib/init-profile.js";
import {
  applyInitWrites,
  logInitNextSteps,
  logInitSummary,
  planInitAssets,
  type PlannedWrite,
} from "../lib/init-plan.js";

export interface InitOptions {
  force?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  cwd?: string;
  ides?: string;
  docsPath?: string;
  skills?: string;
  hooks?: boolean;
  noHooks?: boolean;
  ci?: boolean;
  noCi?: boolean;
  archSource?: string;
  archLocation?: string;
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

function planArchitecturePointerWrite(profile: InitProfile, repoRoot: string): PlannedWrite | null {
  const targetAbs = path.join(repoRoot, REL_ARCHITECTURE_POINTER.split("/").join(path.sep));
  if (fs.existsSync(targetAbs)) return null;
  const body = serializeArchitecturePointer(composeArchitecturePointer(profile));
  return { absoluteTarget: targetAbs, body, executable: false };
}

function planIntegrationsDocWrite(
  profile: InitProfile,
  templatesRoot: string,
  repoRoot: string,
  compat: ReturnType<typeof loadIntegrationCompat>,
): PlannedWrite | null {
  const rel = validateIntegrationsDocPath(repoRoot, profile.integrationsDocPath);
  const targetAbs = path.join(repoRoot, rel.split("/").join(path.sep));
  if (fs.existsSync(targetAbs)) return null;
  const body = composeIntegrationsDoc(profile, templatesRoot, compat);
  return { absoluteTarget: targetAbs, body, executable: false };
}

async function resolveProfile(
  options: InitOptions,
  repoRoot: string,
  templatesRoot: string,
): Promise<InitProfile | null> {
  const partial = profileFromCliFlags(options);
  if (shouldRunInteractiveWizard({ yes: options.yes, partial })) {
    const { runInitInteractiveWizard } = await import("../lib/init-interactive.js");
    return runInitInteractiveWizard(repoRoot, templatesRoot, partial);
  }
  return mergeInitProfile(defaultInitProfile(), partial);
}

export async function runInit(options: InitOptions = {}): Promise<void> {
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

  let compat;
  try {
    compat = loadIntegrationCompat(templatesRoot);
    recipeFilesExist(templatesRoot, compat);
  } catch (e) {
    logError(e instanceof Error ? e.message : String(e));
    setExitCode(2);
    return;
  }

  const profile = await resolveProfile(options, repoRoot, templatesRoot);
  if (!profile) {
    setExitCode(1);
    return;
  }

  try {
    profile.integrationsDocPath = validateIntegrationsDocPath(repoRoot, profile.integrationsDocPath);
  } catch (e) {
    logError(e instanceof Error ? e.message : String(e));
    setExitCode(2);
    return;
  }

  for (const id of profile.ides) {
    if (!compat.integrations[id as keyof typeof compat.integrations]) {
      logError(`init: unknown IDE key: ${id}`);
      setExitCode(2);
      return;
    }
  }

  const assets = resolveAssetsFromProfile(profile, compat);
  let force = options.force === true;
  let plan = planInitAssets(assets, templatesRoot, repoRoot, force);
  if (!plan.ok) {
    setExitCode(2);
    return;
  }
  if (plan.conflicts.length > 0) {
    logManagedAssetConflicts(plan.conflicts);

    const { canPromptInitOverwrite, promptOverwriteManagedAssets } = await import(
      "../lib/init-interactive.js"
    );
    if (canPromptInitOverwrite(options)) {
      const overwrite = await promptOverwriteManagedAssets(plan.conflicts);
      if (overwrite !== true) {
        setExitCode(overwrite === null ? 1 : 2);
        return;
      }
      force = true;
      plan = planInitAssets(assets, templatesRoot, repoRoot, force);
      if (!plan.ok) {
        setExitCode(2);
        return;
      }
    } else {
      logError("pass --force to overwrite without prompting");
      setExitCode(2);
      return;
    }
  }

  const docWrite = planIntegrationsDocWrite(profile, templatesRoot, repoRoot, compat);
  const pointerWrite = planArchitecturePointerWrite(profile, repoRoot);
  const composedWrites = [docWrite, pointerWrite].filter((w): w is PlannedWrite => w != null);
  const allWrites = [...plan.writes, ...composedWrites];

  if (options.dryRun) {
    logInfo(`${CLI_NAME} init: dry-run — would write ${allWrites.length} file(s)`);
    for (const w of allWrites) {
      logInfo(`  - ${path.relative(repoRoot, w.absoluteTarget)}`);
    }
    if (docWrite) {
      logInfo(`${CLI_NAME} init: composed ${profile.integrationsDocPath} (${docWrite.body.length} bytes)`);
    }
    if (pointerWrite) {
      logInfo(`${CLI_NAME} init: composed ${REL_ARCHITECTURE_POINTER} (kind=${profile.architectureSource})`);
    }
    return;
  }

  applyInitWrites(allWrites);
  if (docWrite) {
    logInfo(`${CLI_NAME} init: wrote composed ${profile.integrationsDocPath}`);
  }
  if (pointerWrite) {
    logInfo(`${CLI_NAME} init: wrote composed ${REL_ARCHITECTURE_POINTER} (kind=${profile.architectureSource})`);
  }
  logInitSummary(plan.writes, plan.skippedUserMutable, plan.unchanged);
  logInitNextSteps(profile);
  mergeGitignoreFromTemplate(repoRoot, templatesRoot);
}
