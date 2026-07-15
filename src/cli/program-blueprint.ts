import type { Command } from "commander";
import { runBlueprintCommand } from "./commands/blueprint.js";

export function registerBlueprintCommands(program: Command): void {
  program
    .command("blueprint")
    .description(
      "Co-author ARCHITECTURE.md, TARGET_ARCHITECTURE.yaml, and verification_plan.json from discovery interview",
    )
    .option("--yes", "Accept defaults without interactive prompts")
    .action(async (opts: { yes?: boolean }) => {
      await runBlueprintCommand({ yes: opts.yes });
    });
}
