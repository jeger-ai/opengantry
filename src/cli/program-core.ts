import { Option, type Command } from "commander";
import { runInit } from "./commands/init.js";
import { runUpgrade, type UpgradeOptions } from "./commands/upgrade.js";
import { runDoctor } from "./commands/doctor.js";
import { runOnboarding } from "./commands/onboarding.js";
import { runReceiptList, runReceiptShow } from "./commands/receipt.js";
import type { InitOptions } from "./commands/init.js";
import { runPlannerSet, runPlannerShow } from "./commands/planner.js";
import { TYPED_GATE_ADAPTER_IDS, type TypedGateAdapterId } from "#core/gate-adapter.js";
import { currentReporter } from "./output/reporter.js";

/** Shared `gantry init` Commander flags (used by init command registration). */
function addInitOptions(cmd: Command): Command {
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
      "--tutorial",
      "After init, run guided first mission graph (Planner stamp + verify walkthrough)",
    );
}

function registerReceiptCommand(program: Command): void {
  const receipt = program.command("receipt").description("Inspect local attestation receipts (gitignored history)");

  receipt
    .command("list")
    .description("List receipts under .gitagent/history/receipts/")
    .option("--msn <id>", "Filter by MSN id prefix")
    .option("--json", "Emit structured JSON")
    .action((opts: { msn?: string; json?: boolean }) => {
      runReceiptList(opts);
    });

  receipt
    .command("show")
    .description("Show receipt by path, MSN id (latest), or most recent when omitted")
    .argument("[target]", "Receipt path or MSN-NNNN")
    .option("--json", "Emit structured JSON")
    .action((target: string | undefined, opts: { json?: boolean }) => {
      runReceiptShow({ target, json: opts.json });
    });
}

function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Active GXT readiness check (warnings do not fail exit)")
    .argument("[policy]", "Expected digests JSON; alias for --policy when npm run swallows flags")
    .option("--json", "Emit structured report")
    .option("--policy <file>", "Compare working-tree digests to expected-digests JSON (offline)")
    .option("--audience <role>", "Tailor next steps: executor|planner|verifier|platform")
    .addOption(
      new Option("--gate-adapter <id>", "Force tsc|eslint adapter preflight").choices([
        ...TYPED_GATE_ADAPTER_IDS,
      ]),
    )
    .option("--adapter-baseline", "Run whole-project tsc/eslint baseline (slow, warn-only)")
    .action(
      (
        policyPositional: string | undefined,
        opts: {
          json?: boolean;
          audience?: string;
          policy?: string;
          gateAdapter?: TypedGateAdapterId;
          adapterBaseline?: boolean;
        },
      ) => {
        runDoctor({
          json: opts.json,
          audience: currentReporter().audience,
          policy: opts.policy ?? policyPositional,
          gateAdapter: opts.gateAdapter,
          adapterBaseline: opts.adapterBaseline,
        });
      },
    );
}

function registerInitCommand(program: Command): void {
  addInitOptions(
    program.command("init").description("Bootstrap OpenGantry substrate assets into current git repository"),
  ).action(async (opts: InitOptions) => runInit(opts));
}

function registerUpgradeCommand(program: Command): void {
  const upgradeCmd = program
    .command("upgrade")
    .description("Plan or apply substrate upgrades from the installed gantry package (Tier-3)");

  upgradeCmd
    .command("plan")
    .description("Preview upgrade file changes; with --stage, write the staging dir and draft the upgrade mission")
    .option("--json", "Emit stable structured JSON (schema_version 1)")
    .option("--msn <id>", "Mission id for the upgrade mission (default: next MSN in 9000-9099 band)")
    .option("--stage", `Stage managed files under .gitagent/.upgrade-tmp/ and write the upgrade mission YAML`)
    .action(async (options: UpgradeOptions & { stage?: boolean }) => {
      await runUpgrade({ ...options, dryRun: options.stage !== true });
    });

  upgradeCmd
    .command("apply")
    .description("Apply a Teacher-signed upgrade mission after hash verification")
    .option("--json", "Emit structured JSON")
    .option("--mission <path>", "Signed upgrade mission YAML (required unless pinned)")
    .action(async (options: UpgradeOptions) => {
      await runUpgrade({ ...options, apply: true });
    });
}

function registerOnboardingCommand(program: Command): void {
  program
    .command("onboarding")
    .description("Interactive walkthrough of the strict GXT mission graph")
    .option("--force", "Continue despite integration health blockers on configured (broken) state")
    .action(async (opts: { force?: boolean }) => {
      await runOnboarding({ force: opts.force });
    });
}

function registerPlannerCommand(program: Command): void {
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

export function registerCoreCommands(program: Command): void {
  registerReceiptCommand(program);
  registerDoctorCommand(program);
  registerInitCommand(program);
  registerUpgradeCommand(program);
  registerOnboardingCommand(program);
  registerPlannerCommand(program);
}
