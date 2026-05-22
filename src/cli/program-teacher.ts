import type { Command } from "commander";
import { runTeacherSet, runTeacherShow } from "./commands/teacher.js";

export function registerTeacherCommands(program: Command): void {
  const teacher = program.command("teacher").description("Repo-local Teacher identity (git-proof allowlist)");

  teacher
    .command("show")
    .description("Show resolved Teacher emails and source for this repository")
    .option("--json", "Emit structured JSON")
    .action((opts: { json?: boolean }) => {
      runTeacherShow({ json: opts.json });
    });

  teacher
    .command("set")
    .description(`Write ${".gitagent/foreman/TEACHER.allowlist.local"} (gitignored, per-repo)`)
    .argument("<emails...>", "One or more Teacher emails (comma-separated ok)")
    .action((emails: string[]) => {
      runTeacherSet({ emails });
    });
}
