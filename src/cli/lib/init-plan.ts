import fs from "node:fs";
import path from "node:path";
import { CLI_NAME } from "./constants.js";
import { logError, logInfo } from "./cli-io.js";
import {
  audienceSectionTitle,
  filterTaggedStepsForAudience,
  formatAudienceNextStep,
  INIT_TAGGED_NEXT_STEPS,
  type AudienceNextStep,
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


export function logInitNextSteps(profile?: InitProfile): void {
  const tagged: AudienceNextStep[] = [...INIT_TAGGED_NEXT_STEPS];
  if (profile?.integrationsDocPath) {
    tagged.push({ audience: "platform", step: `human IDE setup: ${profile.integrationsDocPath}` });
  }
  if (profile?.gitHooks === false) {
    const hookIdx = tagged.findIndex((t) => t.step.startsWith("git config core.hooksPath"));
    if (hookIdx >= 0) tagged.splice(hookIdx, 1);
  }
  const audience = getOutputAudience();
  const filtered = filterTaggedStepsForAudience(audience, tagged).map((step) =>
    formatAudienceNextStep(step, audience),
  );
  const section = audienceSectionTitle(audience) ?? "next steps";
  logInfo(`${section}:`);
  for (const step of filtered) logInfo(`  ${step}`);
}
