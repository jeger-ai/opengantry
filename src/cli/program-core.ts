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
    .option("--force", "Overwrite managed runtime assets when conflicts exist")
    .action((opts: { force?: boolean }) => {
      runInit({ force: opts.force });
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
