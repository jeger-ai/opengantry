import type { Command } from "commander";
import { runCheck } from "./commands/check.js";
import { runInit } from "./commands/init.js";
import { runUpgrade, type UpgradeOptions } from "./commands/upgrade.js";
import { runStatus } from "./commands/status.js";
import { runDoctor } from "./commands/doctor.js";
import { runOnboarding } from "./commands/onboarding.js";
import { runStart } from "./commands/start.js";
import { runTriage, type TriageRunOptions } from "./commands/triage.js";
import { readStdinIfEmpty } from "./lib/program-stdin.js";
import type { InitOptions } from "./commands/init.js";
import type { StartOptions } from "./lib/start-orchestration.js";
import { getOutputAudience } from "./lib/output-context.js";
import { logError, setExitCode } from "./lib/cli-io.js";

/** Commander-parsed triage flags (intent text is a positional arg). */
type TriageCliOptions = Omit<TriageRunOptions, "text">;

/** Commander `--no-write` maps to `write`; start adapter maps to `writeMission`. */
type StartCliOptions = Omit<StartOptions, "intent" | "writeMission" | "audience" | "silent"> & {
  write?: boolean;
};

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
        audience: getOutputAudience(),
      });
    });

  program
    .command("doctor")
    .description("Active GXT readiness check (warnings do not fail exit)")
    .option("--json", "Emit structured report")
    .option("--audience <role>", "Tailor next steps: worker|teacher|verifier|platform")
    .action((opts: { json?: boolean; audience?: string }) => {
      runDoctor({ json: opts.json, audience: getOutputAudience() });
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
    .option(
      "--tutorial",
      "After init, run guided first mission loop (Teacher stamp + verify walkthrough)",
    )
    .action(async (opts: InitOptions) => {
      await runInit(opts);
    });

  program
    .command("upgrade")
    .description("Plan or apply substrate upgrades from the installed gapman package (Tier-3)")
    .option("--apply", "Apply a Teacher-signed upgrade mission after hash verification")
    .option("--dry-run", "Print upgrade plan without writing staging dir or mission YAML")
    .option("--json", "Emit structured JSON")
    .option("--msn <id>", "Mission id for upgrade plan (default: next MSN in 9000-9099 band)")
    .option("--mission <path>", "Signed upgrade mission YAML (required for --apply unless pinned)")
    .action((options: UpgradeOptions) => {
      runUpgrade(options);
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
    .action(async (intentParts: string[], options: TriageCliOptions, _cmd: Command) => {
      let text = intentParts.join(" ").trim();
      text = await readStdinIfEmpty(text);
      if (!text) {
        logError("triage: provide intent text or pipe stdin");
        setExitCode(2);
        return;
      }
      runTriage({ ...options, text });
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
    .action(async (intentParts: string[], options: StartCliOptions, _cmd: Command) => {
      let text = intentParts.join(" ").trim();
      text = await readStdinIfEmpty(text);
      if (!text) {
        logError("start: provide intent text or pipe stdin");
        setExitCode(2);
        return;
      }
      const { write, ...startFlags } = options;
      // Adapter: Commander --no-write → writeMission; audience from output context (not CLI flag).
      runStart({
        ...startFlags,
        intent: text,
        writeMission: write !== false,
        audience: getOutputAudience(),
      });
    });

  program
    .command("onboarding")
    .description("Interactive walkthrough of the strict GXT mission loop")
    .option("--force", "Continue despite integration doctor warnings")
    .action(async (opts: { force?: boolean }) => {
      await runOnboarding({ force: opts.force });
    });
}
