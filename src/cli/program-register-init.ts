import type { Command } from "commander";
import { runInit } from "./commands/init.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Bootstrap OpenGantry substrate assets into current git repository")
    .option("--force", "Overwrite managed assets on conflict without prompting")
    .option("--yes", "Use default profile without interactive wizard")
    .option("--dry-run", "Print planned writes without applying")
    .option("--ides <csv>", "Comma-separated IDE keys (cursor, claude-code, …)")
    .option("--docs-path <path>", "Repo-relative integrations doc path")
    .option("--skills <preset>", "Skills preset: minimal | specimen")
    .option("--hooks", "Install git hooks")
    .option("--no-hooks", "Skip git hooks")
    .option("--ci", "Install CI workflow")
    .option("--no-ci", "Skip CI workflow")
    .option("--arch-source <kind>", "Architecture source: unset | file | directory | external")
    .option("--arch-location <path>", "Architecture file path, folder, or external URL")
    .action(async (opts: {
      force?: boolean;
      yes?: boolean;
      dryRun?: boolean;
      ides?: string;
      docsPath?: string;
      skills?: string;
      hooks?: boolean;
      noHooks?: boolean;
      ci?: boolean;
      noCi?: boolean;
      archSource?: string;
      archLocation?: string;
    }) => {
      await runInit({
        force: opts.force,
        yes: opts.yes,
        dryRun: opts.dryRun,
        ides: opts.ides,
        docsPath: opts.docsPath,
        skills: opts.skills,
        hooks: opts.hooks,
        noHooks: opts.noHooks,
        ci: opts.ci,
        noCi: opts.noCi,
        archSource: opts.archSource,
        archLocation: opts.archLocation,
      });
    });
}
