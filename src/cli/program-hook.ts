import type { Command } from "commander";
import { hookStdin, runHookPostCheckout, runHookPreCommit, runHookPrePush } from "./commands/hook.js";

/** `gantry hook <name>`: what the tracked `.githooks/*` one-line shims call (ADR-0052 A8). */
export function registerHookCommands(program: Command): void {
  const hook = program
    .command("hook")
    .description("Git hook entry points; the tracked .githooks/* scripts call these");

  hook
    .command("pre-commit")
    .description("TMVC guard on the staged index (blocks when strict is armed), then an advisory contract import scan")
    .action(async () => {
      await runHookPreCommit();
    });

  hook
    .command("pre-push")
    .description("Reads git's ref lines on stdin; per pushed range: verify --pre-push on changed missions, perimeter advisory, manifest check")
    .action(async () => {
      await runHookPrePush(await hookStdin());
    });

  hook
    .command("post-checkout")
    .description("Creates EXECUTOR_LOG.md from the template on the first checkout of a feature branch")
    .argument("[prev]", "Previous HEAD (passed by git)")
    .argument("[next]", "New HEAD (passed by git)")
    .argument("[flag]", "1 for a branch checkout, 0 for a file checkout (passed by git)")
    .action((prev: string | undefined, next: string | undefined, flag: string | undefined) => {
      runHookPostCheckout({ prev, next, flag });
    });
}
