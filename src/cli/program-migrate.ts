import type { Command } from "commander";
import { runMigrateArchitecturePointer, runMigrateConfig, runMigrateManifest, type MigrateOptions, type MigrateResult } from "./commands/migrate.js";

const VERBS: { verb: string; description: string; run: (options: MigrateOptions) => MigrateResult }[] = [
  { verb: "manifest", description: ".gitagent/foreman/MANIFEST.json (3.x) becomes MANIFEST.yaml; the JSON form is removed", run: runMigrateManifest },
  { verb: "config", description: ".gitagent/config.json (3.x) becomes config.yaml; the JSON form is removed", run: runMigrateConfig },
  {
    verb: "architecture-pointer",
    description: ".gitagent/ARCHITECTURE.pointer.json (3.x) becomes ARCHITECTURE.pointer.yaml; the JSON form is removed",
    run: runMigrateArchitecturePointer,
  },
];

/** `gantry migrate <file>`: deterministic format migrations of the law files (ADR-0047). */
export function registerMigrateCommands(program: Command): void {
  const migrate = program.command("migrate").description("Deterministic format migrations of the law files (humans write YAML)");
  for (const { verb, description, run } of VERBS) {
    migrate
      .command(verb)
      .description(description)
      .option("--dry-run", "Report what would change; write nothing")
      .option("--json", "Machine-readable result on stdout")
      .action((opts: { dryRun?: boolean; json?: boolean }) => {
        run({ dryRun: opts.dryRun, json: opts.json });
      });
  }
}
