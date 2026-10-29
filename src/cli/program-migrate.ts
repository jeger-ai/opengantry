import path from "node:path";
import type { Command } from "commander";
import { LAW_FILES, type LawFileId } from "#core/law-file.js";
import { runMigrate, type MigrateOptions } from "./commands/migrate.js";

/** `gantry migrate <file>`: one verb per law file, the deterministic ADR-0047 format migration. */
export function registerMigrateCommands(program: Command): void {
  const migrate = program.command("migrate").description("Deterministic format migrations of the law files (humans write YAML)");
  for (const id of Object.keys(LAW_FILES) as LawFileId[]) {
    const file = LAW_FILES[id];
    migrate
      .command(id)
      .description(`${file.json} (3.x) becomes ${path.posix.basename(file.yaml)}; the JSON form is removed`)
      .option("--dry-run", "Report what would change; write nothing")
      .option("--json", "Machine-readable result on stdout")
      .action((opts: MigrateOptions) => {
        runMigrate(id, opts);
      });
  }
}
