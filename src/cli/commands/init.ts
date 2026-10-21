import { INIT_TAGGED_NEXT_STEPS, type AudienceNextStep } from "../output/audience-output.js";
import { currentReporter } from "../output/reporter.js";
import { EXIT_CODE } from "#core/exit-codes.js";
import path from "node:path";
import fs from "node:fs";
import { CLI_NAME, REL_ARCHITECTURE_POINTER_YAML } from "#core/constants.js";
import { readLawFileAt } from "#git/repo-text.js";
import { manifestExists } from "#missions/manifest.js";
import { logError, logInfo, logManagedAssetConflicts, reportMerged, setExitCode } from "../output/cli-io.js";
import { reportCommandError, resolveRepoRootAtBoundary } from "../output/command-boundary.js";
import {
  isIntegrationIdeKey,
  loadIntegrationCompat,
  resolveTemplateRootFromModule,
  type IntegrationCompatManifest,
} from "#missions/integration-compat.js";
import { resolveAssetsFromProfile } from "#missions/init/init-asset-catalog.js";
import {
  composeArchitecturePointer,
  serializeArchitecturePointer,
  composeIntegrationsDoc,
  recipeFilesExist,
} from "#missions/init/init-compose.js";
import {
  defaultInitProfile,
  mergeInitProfile,
  profileFromCliFlags,
  shouldRunInteractiveWizard,
  validateIntegrationsDocPath,
  type InitProfile,
} from "#missions/init/init-profile.js";
import {
  applyInitWrites,
  planInitAssets,
  type InitBodyTransform,
  type InitPlanResult,
  type PlannedWrite,
} from "#missions/init/init-plan.js";
import {
  mergeGitignoreFromTemplate,
  mergePrettierignoreFromTemplate,
} from "#missions/file-merge-gxt.js";
import { ensureSubstrateVersionOnInit } from "#missions/substrate-version.js";
import { ensurePlannerAllowlistOnInit } from "#missions/planner-identity.js";

export interface InitOptions {
  force?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  tutorial?: boolean;
  discover?: boolean;
  discoverStdout?: boolean;
  domain?: string;
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
  if (readLawFileAt(repoRoot, "architecture-pointer") !== null) return null;
  const targetAbs = path.join(repoRoot, REL_ARCHITECTURE_POINTER_YAML.split("/").join(path.sep));
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
    // Lazy-load: interactive wizard + @clack/prompts not needed on non-interactive init paths.
    const { runInitInteractiveWizard } = await import("../init/init-interactive.js");
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
  const repoRoot = resolveRepoRootAtBoundary(options.cwd);
  if (repoRoot === null) return null;

  try {
    const templatesRoot = resolveTemplateRootFromModule();
    const compat = loadIntegrationCompat(templatesRoot);
    recipeFilesExist(templatesRoot, compat);
    return { repoRoot, templatesRoot, compat };
  } catch (e) {
    reportCommandError(e);
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
    reportCommandError(e);
    return false;
  }

  for (const id of profile.ides) {
    if (!isIntegrationIdeKey(id) || !compat.integrations[id]) {
      logError(`init: unknown IDE key: ${id}`);
      setExitCode(EXIT_CODE.USAGE);
      return false;
    }
  }
  return true;
}

async function resolveInitAssetPlan(
  options: InitOptions,
  profile: InitProfile,
  assets: ReturnType<typeof resolveAssetsFromProfile>,
  templatesRoot: string,
  repoRoot: string,
) {
  const transformBody: InitBodyTransform | undefined = undefined;
  let force = options.force === true;
  let plan = planInitAssets(assets, templatesRoot, repoRoot, force, transformBody);
  if (!plan.ok) return planFailed(plan);
  if (plan.conflicts.length === 0) {
    return { plan, force };
  }

  logManagedAssetConflicts(plan.conflicts);
  // Lazy-load: overwrite prompts only when managed-asset conflicts need resolution.
  const { canPromptInitOverwrite, promptOverwriteManagedAssets } = await import(
    "../init/init-interactive.js"
  );
  if (!canPromptInitOverwrite(options)) {
    logError("pass --force to overwrite without prompting");
    setExitCode(EXIT_CODE.USAGE);
    return null;
  }

  const overwrite = await promptOverwriteManagedAssets(plan.conflicts);
  if (overwrite !== true) {
    setExitCode(overwrite === null ? 1 : 2);
    return null;
  }

  force = true;
  plan = planInitAssets(assets, templatesRoot, repoRoot, force, transformBody);
  if (!plan.ok) return planFailed(plan);
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
    logInfo(`${CLI_NAME} init: composed ${REL_ARCHITECTURE_POINTER_YAML} (kind=${profile.architectureSource})`);
  }
}

function substrateAlreadyPresent(repoRoot: string): boolean {
  return manifestExists(repoRoot);
}

export async function runInit(options: InitOptions = {}): Promise<void> {
  const workspace = loadInitWorkspace(options);
  if (!workspace) return;

  const { repoRoot, templatesRoot, compat } = workspace;

  if (options.discover === true) {
    const { runInitDiscoverFlow } = await import("../init/init-discover.js");
    await runInitDiscoverFlow(repoRoot, {
      yes: options.yes,
      stdout: options.discoverStdout,
      domain: options.domain,
    });
    if (!options.discoverStdout) {
      logInfo(`${CLI_NAME} init: discovery complete — run init without --discover to scaffold substrate`);
    }
    return;
  }

  if (
    options.tutorial === true &&
    !options.dryRun &&
    !options.force &&
    substrateAlreadyPresent(repoRoot)
  ) {
    logInfo(`${CLI_NAME} init: substrate already present — tutorial only (skip re-scaffold)`);
    // Lazy-load: init-tutorial pulls @clack/prompts; only used with --tutorial.
    const { runInitTutorial } = await import("../init/init-tutorial.js");
    await runInitTutorial();
    mergeFragments(repoRoot, templatesRoot);
    return;
  }
  const profile = await resolveProfile(options, repoRoot, templatesRoot);
  if (!profile) {
    setExitCode(EXIT_CODE.FAILURE);
    return;
  }
  if (!validateInitProfile(profile, repoRoot, compat)) return;

  const assets = resolveAssetsFromProfile(profile, compat, templatesRoot);
  const assetPlan = await resolveInitAssetPlan(options, profile, assets, templatesRoot, repoRoot);
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
  ensurePlannerAllowlistOnInit(repoRoot);
  if (docWrite) {
    logInfo(`${CLI_NAME} init: wrote composed ${profile.integrationsDocPath}`);
  }
  if (pointerWrite) {
    logInfo(`${CLI_NAME} init: wrote composed ${REL_ARCHITECTURE_POINTER_YAML} (kind=${profile.architectureSource})`);
  }
  logInitSummary(plan.writes, plan.skippedUserMutable, plan.unchanged);
  if (options.tutorial) {
    // Lazy-load: init-tutorial pulls @clack/prompts; only used with --tutorial.
    const { runInitTutorial } = await import("../init/init-tutorial.js");
    await runInitTutorial();
  } else {
    logInitNextSteps(profile);
  }
  mergeFragments(repoRoot, templatesRoot);
}

/** Append the gitignore and prettierignore fragments and say what was appended. */
function mergeFragments(repoRoot: string, templatesRoot: string): void {
  reportMerged([mergeGitignoreFromTemplate(repoRoot, templatesRoot), mergePrettierignoreFromTemplate(repoRoot, templatesRoot)]);
}

function planFailed(plan: InitPlanResult): null {
  if (plan.missingTemplate) logError(`init: missing template for ${plan.missingTemplate.targetPath} at ${plan.missingTemplate.templateAbs}`);
  setExitCode(EXIT_CODE.USAGE);
  return null;
}

function logInitSummary(
  writes: PlannedWrite[],
  skippedUserMutable: string[],
  unchanged: string[],
): void {
  logInfo(`${CLI_NAME} init: wrote ${writes.length} files`);
  if (skippedUserMutable.length > 0) {
    logInfo(`${CLI_NAME} init: preserved ${skippedUserMutable.length} existing user-managed files`);
  }
  if (unchanged.length > 0) {
    logInfo(`${CLI_NAME} init: ${unchanged.length} files already up to date`);
  }
}


function logInitNextSteps(profile?: InitProfile): void {
  const tagged: AudienceNextStep[] = [...INIT_TAGGED_NEXT_STEPS];
  if (profile?.integrationsDocPath) {
    tagged.push({ audience: "platform", step: `human IDE setup: ${profile.integrationsDocPath}` });
  }
  if (profile?.gitHooks === false) {
    const hookIdx = tagged.findIndex((t) => t.step.startsWith("git config core.hooksPath"));
    if (hookIdx >= 0) tagged.splice(hookIdx, 1);
  }
  currentReporter().nextSteps("next steps", [], tagged);
}
