import fs from "node:fs";
import path from "node:path";
import { CLI_NAME } from "./constants.js";
import { logError, logInfo } from "./cli-io.js";
import {
  audienceSectionTitle,
  filterNextStepsForAudience,
  formatAudienceNextStep,
} from "./audience-output.js";
import { getOutputAudience } from "./output-context.js";
import type { InitAsset } from "./init-asset-catalog.js";
import { templatePathForAsset, type InitAssetSpec } from "./init-asset-catalog.js";
import type { InitProfile } from "./init-profile.js";

export interface PlannedWrite {
  absoluteTarget: string;
  body: string;
  executable: boolean;
}

export interface InitPlanResult {
  ok: boolean;
  writes: PlannedWrite[];
  skippedUserMutable: string[];
  unchanged: string[];
  conflicts: string[];
}

export function planInitAssets(
  assets: (InitAsset | InitAssetSpec)[],
  templatesRoot: string,
  repoRoot: string,
  force: boolean,
): InitPlanResult {
  const writes: PlannedWrite[] = [];
  const conflicts: string[] = [];
  const skippedUserMutable: string[] = [];
  const unchanged: string[] = [];

  for (const asset of assets) {
    const spec = asset as InitAssetSpec;
    const templateRel = "templatePath" in spec && spec.templatePath
      ? spec.templatePath
      : templatePathForAsset(spec);
    const templateAbs = path.join(templatesRoot, templateRel.split("/").join(path.sep));
    const targetAbs = path.join(repoRoot, asset.targetPath.split("/").join(path.sep));
    if (!fs.existsSync(templateAbs)) {
      logError(`init: missing template for ${asset.targetPath} at ${templateAbs}`);
      return { ok: false, writes, skippedUserMutable, unchanged, conflicts };
    }
    const body = fs.readFileSync(templateAbs, "utf8");
    const existing = fs.existsSync(targetAbs) ? fs.readFileSync(targetAbs, "utf8") : null;

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
    if (force) {
      writes.push({ absoluteTarget: targetAbs, body, executable: asset.executable === true });
      continue;
    }
    conflicts.push(asset.targetPath);
  }

  return { ok: true, writes, skippedUserMutable, unchanged, conflicts };
}

export function applyInitWrites(writes: PlannedWrite[]): void {
  for (const w of writes) {
    fs.mkdirSync(path.dirname(w.absoluteTarget), { recursive: true });
    fs.writeFileSync(w.absoluteTarget, w.body, "utf8");
    if (w.executable) fs.chmodSync(w.absoluteTarget, 0o755);
  }
}

export function logInitSummary(
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

const INIT_NEXT_STEPS: string[] = [
  "edit .gitagent/foreman/MANIFEST.json (tmvc_roots, forbidden_zones, skills) and run gantry check",
  "git config core.hooksPath .githooks",
  'gantry teacher set "$(git config user.email)"',
  'gantry start "<intent>" --msn MSN-0001 --skill-key <manifest-key>',
  'Teacher: git commit -m "[MSN-0001] legislate mission" including mission file',
  "eval \"$(gantry runtime env --mission .gitagent/missions/<file>.yaml)\"",
  "gantry verify --mission .gitagent/missions/<file>.yaml",
  "source scripts/gxt-runtime-env.sh .gitagent/missions/<file>.yaml",
  "scripts/gxt-pin-mission.sh .gitagent/missions/<file>.yaml",
  "gantry onboarding  # guided walkthrough (strict checks)",
];

export function logInitNextSteps(profile?: InitProfile): void {
  const steps = [...INIT_NEXT_STEPS];
  if (profile?.integrationsDocPath) {
    steps.push(`human IDE setup: ${profile.integrationsDocPath}`);
  }
  if (profile?.gitHooks === false) {
    const hookIdx = steps.indexOf("git config core.hooksPath .githooks");
    if (hookIdx >= 0) steps.splice(hookIdx, 1);
  }
  const audience = getOutputAudience();
  const filtered = filterNextStepsForAudience(audience, steps).map((step) =>
    formatAudienceNextStep(step, audience),
  );
  const section = audienceSectionTitle(audience) ?? "next steps";
  logInfo(`${section}:`);
  for (const step of filtered) logInfo(`  ${step}`);
}
