import { EXIT_CODE } from "#core/exit-codes.js";
import { logError, logInfo, setExitCode } from "../lib/cli-io.js";
import { errorMessage, GantryUserError } from "#core/user-error.js";
import { reportCommandError, resolveRepoRootAtBoundary } from "../lib/command-boundary.js";
import { resolveTemplateRootFromModule } from "#missions/integration-compat.js";
import { runUpgradeApply } from "../lib/upgrade/upgrade-apply.js";
import { runUpgradePlan } from "../lib/upgrade/upgrade-plan.js";
import { toStableUpgradePlanPayloadV1 } from "#missions/upgrade/upgrade-plan-payload.js";

export interface UpgradeOptions {
  apply?: boolean;
  dryRun?: boolean;
  json?: boolean;
  msn?: string;
  mission?: string;
  cwd?: string;
}

export function runUpgrade(options: UpgradeOptions = {}): void {
  const repoRoot = resolveRepoRootAtBoundary(options.cwd);
  if (repoRoot === null) return;

  let templatesRoot: string;
  try {
    templatesRoot = resolveTemplateRootFromModule();
  } catch (e) {
    reportCommandError(e);
    return;
  }

  if (options.apply) {
    void runUpgradeApply({
      repoRoot,
      mission: options.mission,
      templatesRoot,
      json: options.json,
    })
      .then((result) => {
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        }
        if (result.status === "blocked") {
          setExitCode(EXIT_CODE.USAGE);
        }
      })
      .catch((e) => {
        handleUpgradeError(e, options.json);
      });
    return;
  }

  try {
    const result = runUpgradePlan({
      repoRoot,
      templatesRoot,
      msn: options.msn,
      dryRun: options.dryRun,
      json: options.json,
    });

    if (options.json) {
      console.log(JSON.stringify(toStableUpgradePlanPayloadV1(result), null, 2));
    }

    if (result.status === "downgrade_blocked") {
      logError(result.message ?? "downgrade blocked");
      setExitCode(EXIT_CODE.USAGE);
      return;
    }

    if (result.status === "already_current") {
      logInfo(result.message ?? "already current");
      return;
    }

    if (result.status === "no_changes") {
      logInfo(result.message ?? "no changes");
      return;
    }
  } catch (e) {
    handleUpgradeError(e, options.json);
  }
}

function handleUpgradeError(e: unknown, json?: boolean): void {
  if (e instanceof GantryUserError) {
    const payload = { error: e.code, message: e.message, hint: e.hint };
    if (json) console.log(JSON.stringify(payload, null, 2));
    else logError(e.message + (e.hint ? `\nFix: ${e.hint}` : ""));
    setExitCode(EXIT_CODE.USAGE);
    return;
  }
  logError(errorMessage(e));
  setExitCode(EXIT_CODE.USAGE);
}
