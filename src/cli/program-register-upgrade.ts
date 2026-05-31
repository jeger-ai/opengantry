import type { Command } from "commander";
import { runUpgrade } from "./commands/upgrade.js";

export function registerUpgradeCommand(program: Command): void {
  program
    .command("upgrade")
    .description("Plan or apply substrate upgrades from the installed gapman package (Tier-3)")
    .option("--apply", "Apply a Teacher-signed upgrade mission after hash verification")
    .option("--dry-run", "Print upgrade plan without writing staging dir or mission YAML")
    .option("--json", "Emit structured JSON")
    .option("--msn <id>", "Mission id for upgrade plan (default: next MSN in 9000-9099 band)")
    .option("--mission <path>", "Signed upgrade mission YAML (required for --apply unless pinned)")
    .action((opts: {
      apply?: boolean;
      dryRun?: boolean;
      json?: boolean;
      msn?: string;
      mission?: string;
    }) => {
      runUpgrade({
        apply: opts.apply,
        dryRun: opts.dryRun,
        json: opts.json,
        msn: opts.msn,
        mission: opts.mission,
      });
    });
}
