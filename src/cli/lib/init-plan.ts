import fs from "node:fs";
import path from "node:path";
import { CLI_NAME } from "./constants.js";
import { logError, logInfo } from "./cli-io.js";
import type { InitAsset } from "./init-assets.js";
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
  logInfo("next steps:");
  logInfo(
    "1) edit .gitagent/foreman/MANIFEST.json (tmvc_roots, forbidden_zones, skills) and run `gapman check`",
  );
  if (profile?.gitHooks !== false) {
    logInfo("2) optional: git config core.hooksPath .githooks");
  }
  logInfo("3) export GAPMAN_TEACHER_EMAILS=<your-git-email>");
  logInfo(
    '4) legislate only after manifest skill keys exist: gapman legislate "<intent>" --msn MSN-0001 --skill-key <manifest-key>',
  );
  logInfo("5) Teacher commit must start with [MSN-0001] and modify that mission file");
  logInfo("6) run gapman runtime env --mission <path> then gapman verify --mission <path>");
  logInfo("7) bootstrap terminal: source scripts/gxt-runtime-env.sh .gitagent/missions/<file>.yaml");
  if (profile?.ides.includes("cursor")) {
    logInfo("8) Cursor: scripts/gxt-pin-mission.sh .gitagent/missions/<file>.yaml — enable hooks in Settings");
  }
  if (profile?.integrationsDocPath) {
    logInfo(`9) human IDE setup reference: ${profile.integrationsDocPath}`);
  }
  logInfo("10) architecture: if pointer kind=unset, agents read ARCHITECTURE-DISCOVERY.md and ask before coding");
}
