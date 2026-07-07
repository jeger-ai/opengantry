import type { Command } from "commander";
import { runPlannerSet, runPlannerShow } from "./commands/planner.js";

export function registerPlannerCommands(program: Command): void {
  const planner = program.command("planner").description("Repo-local Planner identity (git-proof allowlist)");

  planner
    .command("show")
    .description("Show resolved Planner emails and source for this repository")
    .option("--json", "Emit structured JSON")
    .action((opts: { json?: boolean }) => {
      runPlannerShow({ json: opts.json });
    });

  planner
    .command("set")
    .description(`Write ${".gitagent/foreman/PLANNER.allowlist.local"} (gitignored, per-repo)`)
    .argument("<emails...>", "One or more Planner emails (comma-separated ok)")
    .action((emails: string[]) => {
      runPlannerSet({ emails });
    });
}
