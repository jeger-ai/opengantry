import { EXIT_CODE } from "#core/exit-codes.js";
import { logError, logInfo, setExitCode } from "../output/cli-io.js";
import { runUserCommand } from "../output/command-boundary.js";
import { installTmvcStrictHook, readHooksStatus, uninstallTmvcStrictHook } from "#missions/git/git-hooks.js";
import { loadWorkspace } from "#missions/workspace.js";

export function runHooksInstall(): void {
  runUserCommand({ json: false }, () => {
    const { root } = loadWorkspace();
    const result = installTmvcStrictHook(root);
    if (!result.ok) {
      logError(result.message);
      setExitCode(EXIT_CODE.USAGE);
      return;
    }
    if (result.alreadyInstalled) {
      logInfo(`hook install: already armed (core.hooksPath=${result.hooksPath})`);
      return;
    }
    logInfo(`hook install: armed the strict pre-commit TMVC guard (core.hooksPath=${result.hooksPath})`);
    logInfo("bypass: git commit --no-verify");
  });
}

export function runHooksUninstall(): void {
  runUserCommand({ json: false }, () => {
    const { root } = loadWorkspace();
    const result = uninstallTmvcStrictHook(root);
    logInfo(result.removed ? "hook uninstall: cleared gantry.tmvcGuardStrict" : "hook uninstall: strict mode was not armed");
  });
}

export function runHooksStatus(): void {
  runUserCommand({ json: false }, () => {
    const { root } = loadWorkspace();
    const status = readHooksStatus(root);
    logInfo(`hook status: strict=${status.strictArmed ? "armed" : "off"}`);
    logInfo(`hook status: core.hooksPath=${status.hooksPath ?? "unset"}`);
    logInfo(`hook status: pre-commit=${status.preCommitPresent ? "present" : "missing"}`);
  });
}
