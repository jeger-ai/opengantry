import { EXIT_CODE } from "#core/exit-codes.js";
import { logError, logInfo, logWarn, reportMerged, setExitCode } from "../output/cli-io.js";
import { CLI_NAME } from "#core/constants.js";
import { REL_UPGRADE_TMP, type UpgradePlanResult } from "#missions/upgrade/upgrade-plan-types.js";
import { emitCliJson, reportCommandError, resolveRepoRootAtBoundary, runUserCommandAsync } from "../output/command-boundary.js";
import { resolveTemplateRootFromModule } from "../init/templates-root.js";
import { NPM_PACKAGE_NAME } from "../version.gen.js";
import { runUpgradeApply } from "#missions/upgrade/upgrade-apply.js";
import { runUpgradePlan } from "#missions/upgrade/upgrade-plan.js";
import { toStableUpgradePlanPayloadV1 } from "#missions/upgrade/upgrade-plan-payload.js";

export interface UpgradeOptions {
  apply?: boolean;
  dryRun?: boolean;
  json?: boolean;
  msn?: string;
  mission?: string;
  cwd?: string;
}

export async function runUpgrade(options: UpgradeOptions = {}): Promise<void> {
  const repoRoot = resolveRepoRootAtBoundary(options.cwd);
  if (repoRoot === null) return;

  let templatesRoot: string;
  try {
    templatesRoot = resolveTemplateRootFromModule();
  } catch (e) {
    reportCommandError(e);
    return;
  }

  await runUserCommandAsync({ json: options.json, exitCode: EXIT_CODE.USAGE }, async () => {
    if (options.apply) {
      const result = await runUpgradeApply({ repoRoot, mission: options.mission, templatesRoot });
      if (options.json) {
        emitCliJson(result);
      } else {
        for (const w of result.warnings ?? []) logWarn(w);
        if (result.status === "applied") logInfo(result.message);
        reportMerged(result.merged);
      }
      if (result.status === "blocked") setExitCode(EXIT_CODE.USAGE);
      return;
    }

    const result = runUpgradePlan({
      repoRoot,
      templatesRoot,
      packageName: NPM_PACKAGE_NAME,
      msn: options.msn,
      dryRun: options.dryRun,
    });

    if (options.json) {
      emitCliJson(toStableUpgradePlanPayloadV1(result));
    } else if (result.status === "planned") {
      printUpgradePlanSummary(result, options.dryRun === true);
    }

    if (result.status === "downgrade_blocked") {
      logError(result.message ?? "downgrade blocked");
      setExitCode(EXIT_CODE.USAGE);
    } else if (result.status === "already_current") {
      logInfo(result.message ?? "already current");
    } else if (result.status === "no_changes") {
      logInfo(result.message ?? "no changes");
    }
  });
}

/** The human report of a staged or dry-run plan. */
function printUpgradePlanSummary(result: UpgradePlanResult, dryRun: boolean): void {
  const plannedWrites = result.planned_writes ?? [];
  logInfo(`${CLI_NAME} upgrade: ${dryRun ? "dry-run — would stage" : "staged"} ${plannedWrites.length} file(s) under ${REL_UPGRADE_TMP}/`);
  for (const rel of plannedWrites) logInfo(`  - ${rel}`);
  if (dryRun && result.file_changes?.length) {
    logInfo("Changelog preview:");
    for (const c of result.file_changes) {
      const delta = c.bytes_before === null ? `new ${c.bytes_after} bytes` : `${c.bytes_before} → ${c.bytes_after} bytes`;
      logInfo(`  [${c.action}] ${c.path} (${delta})`);
    }
  }
  reportMerged(result.merged);
  if (result.legacy_warning) logWarn(result.legacy_warning);
  logInfo(`${dryRun ? "Would write" : "Wrote upgrade"} mission: ${result.mission_rel ?? ""}`);
  logInfo(`${dryRun ? "Suggested Planner action" : "Review staged diff, then"}:\n${result.suggested_human_action ?? ""}`);
  if (!dryRun) logInfo(`After Planner commit: gantry upgrade apply --mission ${result.mission_rel ?? ""}`);
}
