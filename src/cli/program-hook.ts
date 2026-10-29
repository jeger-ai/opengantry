import type { Command } from "commander";
import { hookStdin, runHookPostCheckout, runHookPreCommit, runHookPrePush } from "./commands/hook.js";
import { runHooksInstall, runHooksStatus, runHooksUninstall } from "./commands/hooks.js";

/** `gantry hook <name>`: what the tracked `.githooks/*` one-line shims call (ADR-0052 A8). */
export function registerHookCommands(program: Command): void {
  const hook = program.command("hook").description("Git hook entry points; the tracked .githooks/* scripts call these");
  hook
    .command("pre-commit")
    .description("TMVC guard on the staged index (blocks when strict is armed), then an advisory contract import scan")
    .action(runHookPreCommit);
  hook
    .command("pre-push")
    .description("Reads git's ref lines on stdin; per pushed range: verify --pre-push on changed missions, perimeter advisory, manifest check")
    .argument("[remote]", "Remote name (passed by git)")
    .argument("[url]", "Remote URL (passed by git)")
    .action(async (remote?: string, url?: string) => runHookPrePush(await hookStdin(), { remote, url }));
  hook
    .command("post-checkout")
    .description("Creates EXECUTOR_LOG.md from the template on the first checkout of a feature branch")
    .argument("[prev]", "Previous HEAD (passed by git)")
    .argument("[next]", "New HEAD (passed by git)")
    .argument("[flag]", "1 for a branch checkout, 0 for a file checkout (passed by git)")
    .action((prev?: string, next?: string, flag?: string) => runHookPostCheckout({ prev, next, flag }));
  hook.command("install").description("Arm the strict TMVC pre-commit guard via local git config").action(runHooksInstall);
  hook.command("uninstall").description("Clear local gantry.tmvcGuardStrict; leave core.hooksPath unchanged").action(runHooksUninstall);
  hook.command("status").description("Show whether strict TMVC pre-commit is armed and which hooks path Git uses").action(runHooksStatus);
}
