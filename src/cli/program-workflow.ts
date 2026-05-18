import type { Command } from "commander";
import { runLegislate } from "./commands/legislate.js";
import { runMetrics } from "./commands/metrics.js";
import { runVerify } from "./commands/verify.js";
import { readStdinIfEmpty } from "./commands/triage.js";
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
    .action(async function (this: Command, intentParts: string[]) {
      const opts = this.opts<{ msn: string; skillKey?: string; out?: string; allowDuplicate?: boolean }>();
      let text = intentParts.join(" ").trim();
      text = await readStdinIfEmpty(text);
      if (!text) {
        logError("legislate: provide intent text or pipe stdin");
        setExitCode(2);
        return;
      }
      runLegislate({
        intent: text,
        msn: opts.msn,
        skillKey: opts.skillKey,
        out: opts.out,
        allowDuplicate: opts.allowDuplicate,
      });
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
    .option("--break-glass", "Skip all verify gates when GXT_BYPASS_SECRET is authorized")
    .option("--reason <text>", "Mandatory break-glass reason (min 10 characters)")
    .option("--commit <sha>", "Git commit to attach break-glass note (default HEAD)")
    .option("--audit-commit", "Write break-glass audit as empty commit instead of git note")
    .action(
      (opts: {
        mission: string;
        workerLog?: string;
        cwd?: string;
        fuzzyTrace?: boolean;
        strictTrace?: boolean;
        breakGlass?: boolean;
        reason?: string;
        commit?: string;
        auditCommit?: boolean;
      }) => {
        runVerify({
          mission: opts.mission,
          workerLog: opts.workerLog,
          cwd: opts.cwd,
          fuzzyTrace: opts.fuzzyTrace,
          strictTrace: opts.strictTrace,
          breakGlass: opts.breakGlass,
          breakGlassReason: opts.reason,
          breakGlassCommit: opts.commit,
          auditCommit: opts.auditCommit,
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
