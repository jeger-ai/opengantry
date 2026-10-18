import type { Command } from "commander";
import { runMigrateConfig, runMigrateManifest } from "./commands/migrate.js";

/** `gantry migrate <file>`: deterministic format migrations of the law files (ADR-0047). */
export function registerMigrateCommands(program: Command): void {
  const migrate = program.command("migrate").description("Deterministic format migrations of the law files (humans write YAML)");
  migrate
    .command("manifest")
    .description(".gitagent/foreman/MANIFEST.json (3.x) becomes MANIFEST.yaml; the JSON form is removed")
    .option("--dry-run", "Report what would change; write nothing")
    .option("--json", "Machine-readable result on stdout")
    .action((opts: { dryRun?: boolean; json?: boolean }) => {
      runMigrateManifest({ dryRun: opts.dryRun, json: opts.json });
    });
  migrate
    .command("config")
    .description(".gitagent/config.json (3.x) becomes config.yaml; the JSON form is removed")
    .option("--dry-run", "Report what would change; write nothing")
    .option("--json", "Machine-readable result on stdout")
    .action((opts: { dryRun?: boolean; json?: boolean }) => {
      runMigrateConfig({ dryRun: opts.dryRun, json: opts.json });
    });
}
