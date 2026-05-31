import type { Command } from "commander";
import { runCheck } from "./commands/check.js";
import { runStatus } from "./commands/status.js";
import { runDoctor } from "./commands/doctor.js";
import { registerInitCommand } from "./program-register-init.js";
import { registerUpgradeCommand } from "./program-register-upgrade.js";
import { registerTriageCommand } from "./program-register-triage.js";

export function registerCoreCommands(program: Command): void {
  program
    .command("check")
    .description("Validate MANIFEST.json + Rule 4.4 skills/ sync")
    .action(() => {
      runCheck();
    });

  program
    .command("status")
    .description("Human-readable manifest + skills sync report")
    .action(() => {
      runStatus();
    });

  program
    .command("doctor")
    .description("Active GXT readiness check (warnings do not fail exit)")
    .option("--json", "Emit structured report")
    .action((opts: { json?: boolean }) => {
      runDoctor({ json: opts.json });
    });

  registerInitCommand(program);
  registerUpgradeCommand(program);
  registerTriageCommand(program);
}
