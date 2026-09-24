import { logError, logInfo, setExitCode } from "../lib/cli-io.js";
import { runUserCommand } from "../lib/command-boundary.js";
import { installTmvcStrictHook, readHooksStatus, uninstallTmvcStrictHook } from "../lib/git/git-hooks.js";
import { loadWorkspace } from "../lib/workspace.js";

export function runHooksInstall(): void {
  runUserCommand({ json: false }, () => {
    const { root } = loadWorkspace();
    const result = installTmvcStrictHook(root);
    if (!result.ok) {
      logError(result.message);
      setExitCode(2);
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
    logInfo(result.removed ? "hooks uninstall: cleared gxt.tmvcGuardStrict" : "hooks uninstall: strict mode was not armed");
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
