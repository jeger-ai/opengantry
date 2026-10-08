import type { Command } from "commander";
import { runCageCommand } from "./commands/cage.js";

/** Shared by `gantry cage` and the standalone `opengantry-cage` bin so the two never drift. */
export function configureCageCommand(cmd: Command): Command {
  return cmd
    .description(
      "Zero-config: run a command, then revert changes to CI configs, .env secrets, git hooks/config and manifest forbidden zones (lockfiles reported)",
    )
    .option("--json", "Emit the digest-only cage report as JSON on stdout")
    .option("--report-only", "Detect and report protected changes without reverting them")
    .option("--max-file-bytes <n>", "Per-file in-memory snapshot cap; larger files are detect-only")
    .allowUnknownOption(true)
    .passThroughOptions()
    .argument("<command...>", "Command to run after --")
    .action(async (command: string[], opts: { json?: boolean; reportOnly?: boolean; maxFileBytes?: string }) => {
      await runCageCommand({ command, ...opts });
    });
}

export function registerCageCommands(program: Command): void {
  configureCageCommand(program.command("cage"));
}
