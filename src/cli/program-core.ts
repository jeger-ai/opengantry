import type { Command } from "commander";
import { runCheck } from "./commands/check.js";
import { runInit } from "./commands/init.js";
import { runUpgrade, type UpgradeOptions } from "./commands/upgrade.js";
import { runStatus } from "./commands/status.js";
import { runDoctor } from "./commands/doctor.js";
import { runOnboarding } from "./commands/onboarding.js";
import { runPin, runUnpin } from "./commands/pin.js";
import { runReceiptList, runReceiptPrincipalHmac, runReceiptShow } from "./commands/receipt.js";
import type { PrincipalHmacOptions } from "./lib/principal-hmac.js";
import { runContextFeed } from "./commands/context-feed.js";
import { runAuditRigorCommand } from "./commands/audit-rigor.js";
import { runStart } from "./commands/start.js";
import { runTriage, type TriageRunOptions } from "./commands/triage.js";
import { readStdinIfEmpty } from "./lib/cli-io.js";
import type { InitOptions } from "./commands/init.js";
import { runBlueprintCommand } from "./commands/blueprint.js";
import { runPlannerSet, runPlannerShow } from "./commands/planner.js";
import type { StartOptions } from "./lib/start-orchestration.js";
import { getOutputAudience } from "./lib/output-context.js";
import { logError, setExitCode } from "./lib/cli-io.js";

/** Commander-parsed triage flags (intent text is a positional arg). */
type TriageCliOptions = Omit<TriageRunOptions, "text">;

/** Commander `--no-write` maps to `write`; start adapter maps to `writeMission`. */
type StartCliOptions = Omit<StartOptions, "intent" | "writeMission" | "audience" | "silent"> & {
  write?: boolean;
};

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
      "After init, run guided first mission graph (Planner stamp + verify walkthrough)",
    );
}

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
    .option("--audience <role>", "Tailor next steps: executor|planner|verifier|platform")
    .action((opts: { json?: boolean; verbose?: boolean; audience?: string }) => {
      runStatus({
        json: opts.json,
        verbose: opts.verbose,
        audience: getOutputAudience(),
      });
    });

  program
    .command("pin")
    .description("Pin active mission for verify/scan/runtime (no args = show current pin)")
    .argument("[mission]", "Mission file (.md or .yaml)")
    .action((mission: string | undefined) => {
      runPin({ mission });
    });

  program.command("unpin").description("Clear active mission pin").action(() => {
    runUnpin();
  });

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

  receipt
    .command("principal-hmac")
    .description("Compute attribution HMACs from the auditor pepper keyring (no git workspace required)")
    .argument("[value]", "Principal value when using --kind")
    .option("--org <id>", "Organization id (or GANTRY_ORG_ID)")
    .option("--keyring <path>", "Pepper keyring path (or GANTRY_PEPPER_KEYRING)")
    .option("--kind <kind>", "Principal kind: email|github_actor")
    .option("--repo <url>", "Repository URL to hash")
    .option("--branch <name>", "Branch name to hash")
    .option("--epochs <spec>", "Pepper epochs: current|all|N,N", "current")
    .option("--json", "Emit structured JSON")
    .action(
      (
        value: string | undefined,
        opts: {
          org?: string;
          keyring?: string;
          kind?: string;
          repo?: string;
          branch?: string;
          epochs?: string;
          json?: boolean;
        },
      ) => {
        runReceiptPrincipalHmac({
          org: opts.org,
          keyring: opts.keyring,
          kind: opts.kind as PrincipalHmacOptions["kind"],
          value,
          repo: opts.repo,
          branch: opts.branch,
          epochs: opts.epochs,
          json: opts.json,
        });
      },
    );

  program
    .command("doctor")
    .description("Active GXT readiness check (warnings do not fail exit)")
    .argument("[policy]", "Expected digests JSON; alias for --policy when npm run swallows flags")
    .option("--json", "Emit structured report")
    .option("--policy <file>", "Compare working-tree digests to expected-digests JSON (offline)")
    .option("--audience <role>", "Tailor next steps: executor|planner|verifier|platform")
    .action(
      (
        policyPositional: string | undefined,
        opts: { json?: boolean; audience?: string; policy?: string },
      ) => {
        runDoctor({
          json: opts.json,
          audience: getOutputAudience(),
          policy: opts.policy ?? policyPositional,
        });
      },
    );

  addInitOptions(
    program.command("init").description("Bootstrap OpenGantry substrate assets into current git repository"),
  ).action(async (opts: InitOptions) => {
      const discover = opts.discover === true || opts.discoverStdout === true;
      await runInit({ ...opts, discover, discoverStdout: opts.discoverStdout });
    });

  const upgradeCmd = program
    .command("upgrade")
    .description("Plan or apply substrate upgrades from the installed gantry package (Tier-3)");

  upgradeCmd
    .command("plan")
    .description("Preview upgrade file changes without writing staging dir or mission YAML")
    .option("--json", "Emit stable structured JSON (schema_version 1)")
    .option("--msn <id>", "Mission id for preview labels (default: next MSN in 9000-9099 band)")
    .action((options: UpgradeOptions) => {
      runUpgrade({ ...options, dryRun: true });
    });

  upgradeCmd
    .command("apply")
    .description("Apply a Teacher-signed upgrade mission after hash verification")
    .option("--json", "Emit structured JSON")
    .option("--mission <path>", "Signed upgrade mission YAML (required unless pinned)")
    .action((options: UpgradeOptions) => {
      runUpgrade({ ...options, apply: true });
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
      "Mission output path for --emit-mission (default .gitagent/missions/ACTIVE_MISSION.md; use under .gitagent/missions/ for gantry verify)",
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
    .option("--audience <role>", "Tailor next steps: executor|planner|verifier|platform")
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
    .description("Interactive walkthrough of the strict GXT mission graph")
    .option("--force", "Continue despite integration health blockers on configured (broken) state")
    .action(async (opts: { force?: boolean }) => {
      await runOnboarding({ force: opts.force });
    });

  program
    .command("context-feed")
    .description("Read or clear the latest verify remediation snapshot for IDE/agent graphs")
    .option("--json", "Emit structured remediation payload")
    .option("--clear", "Atomically clear remediation feed (tombstone swap)")
    .action((opts: { json?: boolean; clear?: boolean }) => {
      runContextFeed({ json: opts.json, clear: opts.clear });
    });

  program
    .command("audit-rigor")
    .description("Meta-governance audit: compiler strictness, coverage artifacts, MANIFEST wildcards")
    .option("--json", "Emit structured report")
    .option("--strict", "Treat warnings as failures")
    .option("--workspace <path>", "Workspace root override (tests; default: git repo root)")
    .action((opts: { json?: boolean; strict?: boolean; workspace?: string }) => {
      runAuditRigorCommand({
        json: opts.json,
        strict: opts.strict,
        workspace: opts.workspace,
      });
    });

  program
    .command("blueprint")
    .description(
      "Co-author ARCHITECTURE.md, TARGET_ARCHITECTURE.yaml, and verification_plan.json from discovery interview",
    )
    .option("--yes", "Accept defaults without interactive prompts")
    .option("--domain <key>", "Domain adapter (code | content)", "code")
    .action(async (opts: { yes?: boolean; domain?: string }) => {
      await runBlueprintCommand({ yes: opts.yes, domain: opts.domain });
    });

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
