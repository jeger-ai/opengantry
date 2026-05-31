import type { Command } from "commander";
import { runMetrics } from "./commands/metrics.js";
import { registerLegislateCommand } from "./program-register-legislate.js";
import { registerVerifyCommand } from "./program-register-verify.js";

export function registerWorkflowCommands(program: Command): void {
  registerLegislateCommand(program);
  registerVerifyCommand(program);

  program
    .command("metrics")
    .description("Git-native governance metrics (no local event ledger)")
    .option("--json", "Emit stable JSON summary")
    .option("--ref <name>", "Git ref to analyze (default HEAD)", "HEAD")
    .action((opts: { json?: boolean; ref?: string }) => {
      runMetrics({ json: opts.json, ref: opts.ref });
    });
}
