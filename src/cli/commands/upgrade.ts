import { CLI_NAME } from "../lib/constants.js";
import { logError, logInfo, setExitCode, errorMessage } from "../lib/cli-io.js";
import { getRepoRoot } from "../lib/git.js";
import { resolveTemplateRootFromModule } from "../lib/integration-compat.js";
import { runUpgradeApply } from "../lib/upgrade-apply.js";
import { runUpgradePlan } from "../lib/upgrade-plan.js";
import { GapmanUserError } from "../lib/errors.js";

export interface UpgradeOptions {
  apply?: boolean;
  dryRun?: boolean;
  json?: boolean;
  msn?: string;
  mission?: string;
  cwd?: string;
}

export function runUpgrade(options: UpgradeOptions = {}): void {
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
    templatesRoot = resolveTemplateRootFromModule();
  } catch (e) {
    logError(errorMessage(e));
    setExitCode(2);
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
          setExitCode(2);
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
      console.log(JSON.stringify(result, null, 2));
    }

    if (result.status === "downgrade_blocked") {
      logError(result.message ?? "downgrade blocked");
      setExitCode(2);
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
  if (e instanceof GapmanUserError) {
    const payload = { error: e.code, message: e.message, hint: e.hint };
    if (json) console.log(JSON.stringify(payload, null, 2));
    else logError(e.message + (e.hint ? `\nFix: ${e.hint}` : ""));
    setExitCode(2);
    return;
  }
  logError(errorMessage(e));
  setExitCode(2);
}
