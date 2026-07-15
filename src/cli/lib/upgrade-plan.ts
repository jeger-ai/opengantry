import fs from "node:fs";
import path from "node:path";
import { CLI_NAME } from "./constants.js";
import { fromPosix, logInfo, logWarn, toPosixRel } from "./cli-io.js";
import {
  mergeGitignoreFromTemplate,
  mergePrettierignoreFromTemplate,
} from "./file-merge-gxt.js";
import { loadIntegrationCompat, resolveTemplateRootFromModule } from "./integration-compat.js";
import { resolveAssetsFromProfile } from "./init-asset-catalog.js";
import { planInitAssets } from "./init-plan.js";
import {
  alreadyCurrentMessage,
  compareSemver,
  legacyVersionWarning,
  readInstalledSubstrateVersion,
} from "./substrate-version.js";
import {
  buildUpgradeFileChanges,
  groupUpgradeChangesByCategory,
  inferInitProfileFromRepo,
  upgradeEligibleAssets,
} from "./upgrade-plan-catalog.js";
import {
  buildUpgradeMissionYaml,
  resolveUpgradeMsn,
  semverSlug,
  writeStagedFiles,
} from "./upgrade-plan-scaffold.js";
import {
  REL_UPGRADE_TMP,
  type RunUpgradePlanOptions,
  type UpgradeFileChange,
  type UpgradePayload,
  type UpgradePlanResult,
} from "./upgrade-plan-types.js";

export {
  REL_UPGRADE_TMP,
  UPGRADE_MSN_BAND_MIN,
  UPGRADE_MSN_BAND_MAX,
  type UpgradeFileChange,
  type UpgradePayload,
  type UpgradePlanResult,
  type RunUpgradePlanOptions,
} from "./upgrade-plan-types.js";
export {
  upgradeEligibleAssets,
  allUpgradeEligibleFromCatalog,
  inferInitProfileFromRepo,
  buildUpgradeFileChanges,
  groupUpgradeChangesByCategory,
} from "./upgrade-plan-catalog.js";
export {
  pickNextUpgradeMsn,
  resolveUpgradeMsn,
  buildUpgradeMissionYaml,
  parseUpgradePayloadFromMissionBody,
} from "./upgrade-plan-scaffold.js";

function resolveUpgradeVersionGate(
  installed: ReturnType<typeof readInstalledSubstrateVersion>,
  bundled: string,
  legacyWarning: string | null,
): UpgradePlanResult | null {
  if (compareSemver(bundled, installed.version) < 0) {
    return {
      status: "downgrade_blocked",
      from_version: installed.version,
      to_version: bundled,
      message: `${CLI_NAME} upgrade: bundled version ${bundled} is older than installed ${installed.version} — downgrade blocked`,
    };
  }

  if (compareSemver(installed.version, bundled) >= 0) {
    return {
      status: "already_current",
      from_version: installed.version,
      to_version: bundled,
      installed_source: installed.source,
      message: alreadyCurrentMessage(installed.version, bundled),
      legacy_warning: legacyWarning,
    };
  }

  return null;
}

function logUpgradePlanSummary(
  options: RunUpgradePlanOptions,
  opts: {
    plannedWrites: string[];
    legacyWarning: string | null;
    missionRel: string;
    suggestedHumanAction: string;
    fileChanges?: UpgradeFileChange[];
  },
): void {
  if (options.json) return;
  logInfo(`${CLI_NAME} upgrade: ${options.dryRun ? "dry-run — would stage" : "staged"} ${opts.plannedWrites.length} file(s) under ${REL_UPGRADE_TMP}/`);
  for (const rel of opts.plannedWrites) logInfo(`  - ${rel}`);
  if (opts.fileChanges?.length) {
    logInfo("Changelog preview:");
    for (const c of opts.fileChanges) {
      const delta =
        c.bytes_before === null
          ? `new ${c.bytes_after} bytes`
          : `${c.bytes_before} → ${c.bytes_after} bytes`;
      logInfo(`  [${c.action}] ${c.path} (${delta})`);
    }
  }
  if (opts.legacyWarning) logWarn(opts.legacyWarning);
  logInfo(`${options.dryRun ? "Would write" : "Wrote upgrade"} mission: ${opts.missionRel}`);
  logInfo(`${options.dryRun ? "Suggested Planner action" : "Review staged diff, then"}:\n${opts.suggestedHumanAction}`);
  if (!options.dryRun) {
    logInfo(`After Planner commit: gantry upgrade --apply --mission ${opts.missionRel}`);
  }
}

export function runUpgradePlan(options: RunUpgradePlanOptions): UpgradePlanResult {
  const repoRoot = path.resolve(options.repoRoot);
  const templatesRoot = options.templatesRoot ?? resolveTemplateRootFromModule();
  const compat = loadIntegrationCompat(templatesRoot);
  const bundled = compat.opengantry_version;
  const installed = readInstalledSubstrateVersion(repoRoot);
  const legacyWarning = legacyVersionWarning(installed.source);

  const versionGate = resolveUpgradeVersionGate(installed, bundled, legacyWarning);
  if (versionGate) return versionGate;

  const profile = inferInitProfileFromRepo(repoRoot, templatesRoot);
  const catalogAssets = resolveAssetsFromProfile(profile, compat, templatesRoot);
  const assets = upgradeEligibleAssets(catalogAssets);
  const plan = planInitAssets(assets, templatesRoot, repoRoot, true);
  if (!plan.ok) {
    throw new Error(`${CLI_NAME} upgrade: asset planning failed`);
  }

  if (plan.writes.length === 0) {
    return {
      status: "no_changes",
      from_version: installed.version,
      to_version: bundled,
      message: `${CLI_NAME} upgrade: no managed_strict asset changes detected`,
      unchanged: plan.unchanged,
      skipped_scaffold_only: plan.skippedUserMutable,
      legacy_warning: legacyWarning,
    };
  }

  const msnId = resolveUpgradeMsn(repoRoot, options.msn);

  const plannedWrites = plan.writes.map((w) =>
    toPosixRel(repoRoot, w.absoluteTarget),
  );

  const missionRel = `.gitagent/missions/${msnId}.upgrade-v${semverSlug(bundled)}.yaml`;
  const missionAbs = path.join(repoRoot, fromPosix(missionRel));
  const suggestedHumanAction = `git add ${missionRel}\ngit commit -m "[${msnId}] approve substrate upgrade to v${bundled}"`;

  const fileChanges = buildUpgradeFileChanges(repoRoot, plan.writes);
  const shared: UpgradePlanResult = {
    status: "planned",
    from_version: installed.version,
    to_version: bundled,
    mission_rel: missionRel,
    suggested_human_action: suggestedHumanAction,
    planned_writes: plannedWrites,
    skipped_scaffold_only: plan.skippedUserMutable,
    unchanged: plan.unchanged,
    legacy_warning: legacyWarning,
    file_changes: fileChanges,
    changes_by_category: groupUpgradeChangesByCategory(fileChanges),
  };

  if (options.dryRun) {
    logUpgradePlanSummary(options, { plannedWrites, legacyWarning, missionRel, suggestedHumanAction, fileChanges });
    return shared;
  }

  const stagedHashes = writeStagedFiles(repoRoot, plan.writes);
  mergeGitignoreFromTemplate(repoRoot, templatesRoot);
  mergePrettierignoreFromTemplate(repoRoot, templatesRoot);
  const payload: UpgradePayload = {
    from_version: installed.version,
    to_version: bundled,
    staged_root: REL_UPGRADE_TMP,
    planned_writes: plannedWrites,
    skipped_scaffold_only: plan.skippedUserMutable,
    staged_hashes: stagedHashes,
    created_at: new Date().toISOString(),
  };
  const missionBody = buildUpgradeMissionYaml({ msnId, fromVersion: installed.version, toVersion: bundled, payload });
  fs.mkdirSync(path.dirname(missionAbs), { recursive: true });
  fs.writeFileSync(missionAbs, missionBody, "utf8");

  logUpgradePlanSummary(options, {
    plannedWrites,
    legacyWarning,
    missionRel,
    suggestedHumanAction,
  });

  return { ...shared, mission_path: missionAbs };
}
