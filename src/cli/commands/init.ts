import path from "node:path";
import fs from "node:fs";
import { CLI_NAME, REL_ARCHITECTURE_POINTER, REL_MANIFEST } from "../lib/constants.js";
import { logError, logInfo, logManagedAssetConflicts, setExitCode } from "../lib/cli-io.js";
import { getRepoRoot } from "../lib/git.js";
import {
  isIntegrationIdeKey,
  loadIntegrationCompat,
  resolveTemplateRootFromModule,
  type IntegrationCompatManifest,
} from "../lib/integration-compat.js";
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
import { mergeGitignoreFromTemplate } from "../lib/gitignore-gxt.js";
import { ensureSubstrateVersionOnInit } from "../lib/substrate-version.js";
import { ensureTeacherAllowlistOnInit } from "../lib/teacher-identity.js";

export interface InitOptions {
  force?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  tutorial?: boolean;
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
  compat: IntegrationCompatManifest,
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

type InitWorkspace = {
  repoRoot: string;
  templatesRoot: string;
  compat: IntegrationCompatManifest;
};

function loadInitWorkspace(options: InitOptions): InitWorkspace | null {
  let repoRoot: string;
  try {
    repoRoot = getRepoRoot(options.cwd);
  } catch (e) {
    logError(e instanceof Error ? e.message.replace(`${CLI_NAME}: `, "") : String(e));
    setExitCode(2);
    return null;
  }

  let templatesRoot: string;
  try {
    templatesRoot = resolveTemplateRootFromModule();
  } catch (e) {
    logError(e instanceof Error ? e.message : String(e));
    setExitCode(2);
    return null;
  }

  try {
    const compat = loadIntegrationCompat(templatesRoot);
    recipeFilesExist(templatesRoot, compat);
    return { repoRoot, templatesRoot, compat };
  } catch (e) {
    logError(e instanceof Error ? e.message : String(e));
    setExitCode(2);
    return null;
  }
}

function validateInitProfile(
  profile: InitProfile,
  repoRoot: string,
  compat: IntegrationCompatManifest,
): boolean {
  try {
    profile.integrationsDocPath = validateIntegrationsDocPath(repoRoot, profile.integrationsDocPath);
  } catch (e) {
    logError(e instanceof Error ? e.message : String(e));
    setExitCode(2);
    return false;
  }

  for (const id of profile.ides) {
    if (!isIntegrationIdeKey(id) || !compat.integrations[id]) {
      logError(`init: unknown IDE key: ${id}`);
      setExitCode(2);
      return false;
    }
  }
  return true;
}

async function resolveInitAssetPlan(
  options: InitOptions,
  assets: ReturnType<typeof resolveAssetsFromProfile>,
  templatesRoot: string,
  repoRoot: string,
) {
  let force = options.force === true;
  let plan = planInitAssets(assets, templatesRoot, repoRoot, force);
  if (!plan.ok) {
    setExitCode(2);
    return null;
  }
  if (plan.conflicts.length === 0) {
    return { plan, force };
  }

  logManagedAssetConflicts(plan.conflicts);
  const { canPromptInitOverwrite, promptOverwriteManagedAssets } = await import(
    "../lib/init-interactive.js"
  );
  if (!canPromptInitOverwrite(options)) {
    logError("pass --force to overwrite without prompting");
    setExitCode(2);
    return null;
  }

  const overwrite = await promptOverwriteManagedAssets(plan.conflicts);
  if (overwrite !== true) {
    setExitCode(overwrite === null ? 1 : 2);
    return null;
  }

  force = true;
  plan = planInitAssets(assets, templatesRoot, repoRoot, force);
  if (!plan.ok) {
    setExitCode(2);
    return null;
  }
  return { plan, force };
}

function logInitDryRun(
  repoRoot: string,
  profile: InitProfile,
  allWrites: PlannedWrite[],
  docWrite: PlannedWrite | null,
  pointerWrite: PlannedWrite | null,
): void {
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
}

function substrateAlreadyPresent(repoRoot: string): boolean {
  return fs.existsSync(path.join(repoRoot, REL_MANIFEST.split("/").join(path.sep)));
}

export async function runInit(options: InitOptions = {}): Promise<void> {
  const workspace = loadInitWorkspace(options);
  if (!workspace) return;

  const { repoRoot, templatesRoot, compat } = workspace;

  if (
    options.tutorial === true &&
    !options.dryRun &&
    !options.force &&
    substrateAlreadyPresent(repoRoot)
  ) {
    logInfo(`${CLI_NAME} init: substrate already present — tutorial only (skip re-scaffold)`);
    const { runInitTutorial } = await import("../lib/init-tutorial.js");
    await runInitTutorial();
    mergeGitignoreFromTemplate(repoRoot, templatesRoot);
    return;
  }
  const profile = await resolveProfile(options, repoRoot, templatesRoot);
  if (!profile) {
    setExitCode(1);
    return;
  }
  if (!validateInitProfile(profile, repoRoot, compat)) return;

  const assets = resolveAssetsFromProfile(profile, compat);
  const assetPlan = await resolveInitAssetPlan(options, assets, templatesRoot, repoRoot);
  if (!assetPlan) return;

  const { plan } = assetPlan;
  const docWrite = planIntegrationsDocWrite(profile, templatesRoot, repoRoot, compat);
  const pointerWrite = planArchitecturePointerWrite(profile, repoRoot);
  const composedWrites = [docWrite, pointerWrite].filter((w): w is PlannedWrite => w != null);
  const allWrites = [...plan.writes, ...composedWrites];

  if (options.dryRun) {
    logInitDryRun(repoRoot, profile, allWrites, docWrite, pointerWrite);
    return;
  }

  applyInitWrites(allWrites);
  ensureSubstrateVersionOnInit(repoRoot, templatesRoot);
  ensureTeacherAllowlistOnInit(repoRoot);
  if (docWrite) {
    logInfo(`${CLI_NAME} init: wrote composed ${profile.integrationsDocPath}`);
  }
  if (pointerWrite) {
    logInfo(`${CLI_NAME} init: wrote composed ${REL_ARCHITECTURE_POINTER} (kind=${profile.architectureSource})`);
  }
  logInitSummary(plan.writes, plan.skippedUserMutable, plan.unchanged);
  if (options.tutorial) {
    const { runInitTutorial } = await import("../lib/init-tutorial.js");
    await runInitTutorial();
  } else {
    logInitNextSteps(profile);
  }
  mergeGitignoreFromTemplate(repoRoot, templatesRoot);
}
