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
      logInfo(`hooks install: already armed (core.hooksPath=${result.hooksPath})`);
      return;
    }
    logInfo(`hooks install: armed tmvc guard --strict (core.hooksPath=${result.hooksPath})`);
    logInfo("bypass: git commit --no-verify");
  });
}

export function runHooksUninstall(): void {
  runUserCommand({ json: false }, () => {
    const { root } = loadWorkspace();
    const result = uninstallTmvcStrictHook(root);
    logInfo(result.removed ? "hooks uninstall: cleared gantry.tmvcGuardStrict" : "hooks uninstall: strict mode was not armed");
  });
}

export function runHooksStatus(): void {
  runUserCommand({ json: false }, () => {
    const { root } = loadWorkspace();
    const status = readHooksStatus(root);
    logInfo(`hooks status: strict=${status.strictArmed ? "armed" : "off"}`);
    logInfo(`hooks status: core.hooksPath=${status.hooksPath ?? "unset"}`);
    logInfo(`hooks status: pre-commit=${status.preCommitPresent ? "present" : "missing"}`);
  });
}
