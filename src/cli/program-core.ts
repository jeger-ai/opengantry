import type { Command } from "commander";
import { runCheck } from "./commands/check.js";
import { runInit } from "./commands/init.js";
import { runStatus } from "./commands/status.js";
import { runDoctor } from "./commands/doctor.js";
import { readStdinIfEmpty, runTriage } from "./commands/triage.js";
import { logError, setExitCode } from "./lib/cli-io.js";

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

  program
    .command("triage")
    .description("Foreman-style triage from manifest (SOUL-aligned)")
    .argument("[intent...]", "User intent text")
    .option("--json", "Print JSON only")
    .option(
      "--emit-mission",
      "Write .gitagent/missions/ACTIVE_MISSION.md from template (DIRECT_EXECUTION only)",
    )
    .option("--msn <id>", "Mission id for --emit-mission", "MSN-0000")
    .option(
      "--out <file>",
      "Mission output path for --emit-mission (default .gitagent/missions/ACTIVE_MISSION.md; use under .gitagent/missions/ for gapman verify)",
    )
    .action(async function (this: Command, intentParts: string[]) {
      const opts = this.opts<{
        json?: boolean;
        emitMission?: boolean;
        msn?: string;
        out?: string;
      }>();
      let text = intentParts.join(" ").trim();
      text = await readStdinIfEmpty(text);
      if (!text) {
        logError("triage: provide intent text or pipe stdin");
        setExitCode(2);
        return;
      }
      runTriage({
        text,
        json: opts.json,
        emitMission: opts.emitMission,
        msn: opts.msn,
        out: opts.out,
      });
    });
}
