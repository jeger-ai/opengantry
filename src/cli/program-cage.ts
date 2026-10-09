import type { Command } from "commander";
import { runCageCommand, runCageGuardPrePush } from "./commands/cage.js";

/** Shared by `gantry cage` and the standalone `opengantry-cage` bin so the two never drift. */
export function configureCageCommand(cmd: Command): Command {
  return cmd
    .description(
      "Zero-config: run a command and restore changes to CI configs, .env secrets, git hooks/config and manifest forbidden zones while it runs and at exit (lockfiles reported); refuses git pushes of protected paths from inside the session",
    )
    .option("--json", "Emit the digest-only cage report as JSON on stdout")
    .option("--report-only", "Detect and report protected changes without reverting them")
    .option("--no-watch", "Check only once, after the command exits (no live restore)")
    .option("--watch-interval-ms <n>", "Live check interval while the command runs (default 1000)")
    .option("--max-file-bytes <n>", "Per-file in-memory snapshot cap; larger files are detect-only")
    .allowUnknownOption(true)
    .passThroughOptions()
    .argument("<command...>", "Command to run after --")
    .action(
      async (
        command: string[],
        opts: { json?: boolean; reportOnly?: boolean; maxFileBytes?: string; watch?: boolean; watchIntervalMs?: string },
      ) => {
        await runCageCommand({ command, ...opts });
      },
    );
}

export function registerCageCommands(program: Command): void {
  configureCageCommand(program.command("cage"));
  program
    .command("cage-guard", { hidden: true })
    .description("Internal: checks run by the cage session git hooks")
    .command("pre-push")
    .requiredOption("--root <dir>", "Cage root (git work tree)")
    .action(async (opts: { root: string }) => {
      await runCageGuardPrePush(opts);
    });
}
