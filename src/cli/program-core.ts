import type { Command } from "commander";
import { runCheck } from "./commands/check.js";
import { runInit } from "./commands/init.js";
import { runUpgrade } from "./commands/upgrade.js";
import { runStatus } from "./commands/status.js";
import { runDoctor } from "./commands/doctor.js";
import { runOnboarding } from "./commands/onboarding.js";
import { runStart } from "./commands/start.js";
import { readStdinIfEmpty, runTriage } from "./commands/triage.js";
import { parseAudience } from "./lib/audience-output.js";
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
    .description("Manifest sync + GXT readiness dashboard")
    .option("--json", "Emit structured report")
    .option("--verbose", "Include all doctor check lines")
    .option("--audience <role>", "Tailor next steps: worker|teacher|verifier|platform")
    .action((opts: { json?: boolean; verbose?: boolean; audience?: string }) => {
      runStatus({
        json: opts.json,
        verbose: opts.verbose,
        audience: parseAudience(opts.audience),
      });
    });

  program
    .command("doctor")
    .description("Active GXT readiness check (warnings do not fail exit)")
    .option("--json", "Emit structured report")
    .option("--audience <role>", "Tailor next steps: worker|teacher|verifier|platform")
    .action((opts: { json?: boolean; audience?: string }) => {
      runDoctor({ json: opts.json, audience: parseAudience(opts.audience) });
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

  program
    .command("start")
    .description("Goal-first orchestration: triage → legislate stub → runtime next steps")
    .argument("[intent...]", "What you want to build")
    .option("--msn <id>", "Mission id (auto-suggested when omitted)")
    .option("--skill-key <key>", "Override Foreman skill_key")
    .option("--gate-command <cmd>", "Deterministic gate command")
    .option("--gate-success-substring <text>", "Gate success substring")
    .option("--no-write", "Skip writing mission file (preview only)")
    .option("--allow-duplicate", "Allow duplicate msn_id (branch migration only)")
    .option("--json", "Emit structured JSON on success")
    .option("--audience <role>", "Tailor next steps: worker|teacher|verifier|platform")
    .action(async function (this: Command, intentParts: string[]) {
      const opts = this.opts<{
        msn?: string;
        skillKey?: string;
        gateCommand?: string;
        gateSuccessSubstring?: string;
        noWrite?: boolean;
        allowDuplicate?: boolean;
        json?: boolean;
        audience?: string;
      }>();
      let text = intentParts.join(" ").trim();
      text = await readStdinIfEmpty(text);
      if (!text) {
        logError("start: provide intent text or pipe stdin");
        setExitCode(2);
        return;
      }
      runStart({
        intent: text,
        msn: opts.msn,
        skillKey: opts.skillKey,
        gateCommand: opts.gateCommand,
        gateSuccessSubstring: opts.gateSuccessSubstring,
        writeMission: opts.noWrite !== true,
        allowDuplicate: opts.allowDuplicate,
        json: opts.json,
        audience: parseAudience(opts.audience),
      });
    });

  program
    .command("onboarding")
    .description("Interactive walkthrough of the strict GXT mission loop")
    .action(async () => {
      await runOnboarding();
    });
}
