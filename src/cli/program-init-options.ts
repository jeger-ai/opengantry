import type { Command } from "commander";

/** Shared `gantry init` Commander flags (used by init command registration). */
export function addInitOptions(cmd: Command): Command {
  return cmd
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
    .option(
      "--defensive-profile <preset>",
      "Defensive profile preset: strict_enterprise | balanced_partner | lean_scratchpad",
    )
    .option("--no-defensive-profile", "Skip defensive profile preset (template defaults)")
    .option(
      "--discover",
      "Run fast-path architecture discovery (emits proposal only until confirmed)",
    )
    .option("--discover-stdout", "Emit discovery proposal JSON to stdout (implies --discover)")
    .option("--domain <key>", "Domain adapter for discovery (code | content)", "code")
    .option(
      "--tutorial",
      "After init, run guided first mission loop (Planner stamp + verify walkthrough)",
    );
}
