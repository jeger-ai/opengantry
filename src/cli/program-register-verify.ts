import type { Command } from "commander";
import { runVerify } from "./commands/verify.js";

export function registerVerifyCommand(program: Command): void {
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
    .option("--pre-push", "Pre-push handoff: git-proof only for legislative stubs; full verify otherwise")
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
        prePush?: boolean;
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
          prePush: opts.prePush,
          breakGlass: opts.breakGlass,
          breakGlassReason: opts.reason,
          breakGlassCommit: opts.commit,
          auditCommit: opts.auditCommit,
        });
      },
    );
}
