import type { Command } from "commander";
import { runLegislate } from "./commands/legislate.js";
import { runMetrics } from "./commands/metrics.js";
import { runVerify } from "./commands/verify.js";
import { readStdinIfEmpty } from "./commands/triage.js";
import { getOutputAudience } from "./lib/output-context.js";
import { logError, setExitCode } from "./lib/cli-io.js";

export function registerWorkflowCommands(program: Command): void {
  program
    .command("legislate")
    .description("Scaffold YAML mission under .gitagent/missions/ using explicit MSN (Teacher still commits)")
    .argument("[intent...]", "One-line Teacher intent summary")
    .requiredOption("--msn <id>", "Explicit mission id (must match MSN-0007)")
    .option("--skill-key <key>", "Override Foreman-derived skill_key when triage escalates")
    .option("--allow-duplicate", "Allow duplicate msn_id only for intentional branch migrations")
    .option("--out <file>", "Output path (.gitagent/missions/…); defaults to MSN.slug.yaml")
    .option(
      "--gate-command <cmd>",
      "Deterministic gate command (quote the full shell string if it contains spaces)",
    )
    .option(
      "--gate-success-substring <text>",
      "Optional substring required in combined gate stdout/stderr",
    )
    .action(async function (this: Command, intentParts: string[]) {
      const opts = this.opts<{
        msn: string;
        skillKey?: string;
        out?: string;
        allowDuplicate?: boolean;
        gateCommand?: string;
        gateSuccessSubstring?: string;
      }>();
      let text = intentParts.join(" ").trim();
      text = await readStdinIfEmpty(text);
      if (!text) {
        logError("legislate: provide intent text or pipe stdin");
        setExitCode(2);
        return;
      }
      const result = runLegislate({
        intent: text,
        msn: opts.msn,
        skillKey: opts.skillKey,
        out: opts.out,
        allowDuplicate: opts.allowDuplicate,
        gateCommand: opts.gateCommand,
        gateSuccessSubstring: opts.gateSuccessSubstring,
      });
      if (!result.ok) setExitCode(result.exitCode);
    });

  program
    .command("verify")
    .description(
      "Git-proof (Teacher + MSN) + deterministic gate + hard-stop trace mapping vs WORKER_LOG.md",
    )
    .requiredOption("--mission <path>", "Mission file (.md or .yaml)")
    .option("--worker-log <path>", "Override WORKER_LOG.md path")
    .option("--cwd <dir>", "Working directory for gate command")
    .option("--fuzzy-trace", "Force content-based anchor matching for all numeric anchors")
    .option("--strict-trace", "Disable auto line-drift resolution (strict line numbers only)")
    .option("--skip-stale-evidence", "Skip TMVC stale-evidence binding for committed PASS trace lines")
    .option("--pre-push", "Pre-push handoff: git-proof only for legislative stubs; full verify otherwise")
    .option("--break-glass", "Skip all verify gates when GXT_BYPASS_SECRET is authorized")
    .option("--reason <text>", "Mandatory break-glass reason (min 10 characters)")
    .option("--commit <sha>", "Git commit to attach break-glass note (default HEAD)")
    .option("--audit-commit", "Write break-glass audit as empty commit instead of git note")
    .option("--fix", "Interactive remediation menu on verify failure")
    .option("--non-interactive", "With --fix: print structured hints without prompts")
    .option("--audience <role>", "Tailor output: worker|teacher|verifier|platform")
    .action(
      async (opts: {
        mission: string;
        workerLog?: string;
        cwd?: string;
        fuzzyTrace?: boolean;
        strictTrace?: boolean;
        skipStaleEvidence?: boolean;
        prePush?: boolean;
        breakGlass?: boolean;
        reason?: string;
        commit?: string;
        auditCommit?: boolean;
        fix?: boolean;
        nonInteractive?: boolean;
        audience?: string;
      }) => {
        await runVerify({
          mission: opts.mission,
          workerLog: opts.workerLog,
          cwd: opts.cwd,
          fuzzyTrace: opts.fuzzyTrace,
          strictTrace: opts.strictTrace,
          skipStaleEvidence: opts.skipStaleEvidence,
          prePush: opts.prePush,
          breakGlass: opts.breakGlass,
          breakGlassReason: opts.reason,
          breakGlassCommit: opts.commit,
          auditCommit: opts.auditCommit,
          fix: opts.fix,
          fixNonInteractive: opts.nonInteractive,
          audience: getOutputAudience(),
        });
      },
    );

  program
    .command("metrics")
    .description("Git-native governance metrics (no local event ledger)")
    .option("--json", "Emit stable JSON summary")
    .option("--ref <name>", "Git ref to analyze (default HEAD)", "HEAD")
    .action((opts: { json?: boolean; ref?: string }) => {
      runMetrics({ json: opts.json, ref: opts.ref });
    });
}
