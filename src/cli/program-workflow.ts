import type { Command } from "commander";
import { runLegislate, type LegislateOptions } from "./commands/legislate.js";
import { runMetrics } from "./commands/metrics.js";
import { runVerify } from "./commands/verify.js";
import type { VerifyOptions, VerifyExportFormat } from "./lib/verify-engine.js";
import { runScan } from "./commands/scan.js";
import { runRegister } from "./commands/register.js";
import { runCheckImports } from "./commands/check-imports.js";
import { runPerimeter } from "./commands/perimeter.js";
import { readStdinIfEmpty } from "./lib/program-stdin.js";
import { getOutputAudience } from "./lib/output-context.js";
import { logError, setExitCode } from "./lib/cli-io.js";

/** Commander-parsed legislate flags (intent text is a positional arg). */
type LegislateCliOptions = Omit<LegislateOptions, "intent" | "silent">;

/** Commander-parsed verify flags (before name/coercion adapter). */
interface VerifyCliOptions {
  mission?: string;
  changedMissions?: boolean;
  baseRef?: string;
  executorLog?: string;
  cwd?: string;
  fuzzyTrace?: boolean;
  strictTrace?: boolean;
  skipStaleEvidence?: boolean;
  ci?: boolean;
  prePush?: boolean;
  breakGlass?: boolean;
  reason?: string;
  commit?: string;
  auditCommit?: boolean;
  fix?: boolean;
  nonInteractive?: boolean;
  json?: boolean;
  format?: string;
  audience?: string;
  scanDepth?: string;
}

function parseVerifyExportFormat(raw?: string): VerifyExportFormat | undefined {
  if (!raw?.trim()) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "json" || v === "sarif" || v === "junit") return v;
  throw new Error(`gantry verify: --format must be json, sarif, or junit (got ${raw})`);
}

function verifyOptionsFromCli(opts: VerifyCliOptions): VerifyOptions {
  const scanDepth =
    opts.scanDepth !== undefined ? Number.parseInt(opts.scanDepth, 10) : undefined;
  const format = opts.format ? parseVerifyExportFormat(opts.format) : undefined;
  return {
    mission: opts.mission,
    changedMissions: opts.changedMissions,
    baseRef: opts.baseRef,
    executorLog: opts.executorLog,
    cwd: opts.cwd,
    fuzzyTrace: opts.fuzzyTrace,
    strictTrace: opts.strictTrace,
    skipStaleEvidence: opts.skipStaleEvidence,
    ci: opts.ci,
    prePush: opts.prePush,
    breakGlass: opts.breakGlass,
    auditCommit: opts.auditCommit,
    fix: opts.fix,
    json: opts.json,
    format,
    scanDepth: Number.isFinite(scanDepth) && scanDepth! > 0 ? scanDepth : undefined,
    breakGlassReason: opts.reason,
    breakGlassCommit: opts.commit,
    fixNonInteractive: opts.nonInteractive,
    audience: getOutputAudience(),
  };
}

export function registerWorkflowCommands(program: Command): void {
  program
    .command("legislate")
    .description("Scaffold YAML mission under .gitagent/missions/ using explicit MSN (Planner still commits)")
    .argument("[intent...]", "One-line Planner intent summary")
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
    .action(async (intentParts: string[], options: LegislateCliOptions, _cmd: Command) => {
      let text = intentParts.join(" ").trim();
      text = await readStdinIfEmpty(text);
      if (!text) {
        logError("legislate: provide intent text or pipe stdin");
        setExitCode(2);
        return;
      }
      const result = runLegislate({ ...options, intent: text });
      if (!result.ok) setExitCode(result.exitCode);
    });

  program
    .command("verify")
    .description(
      "Git-proof (Planner + MSN) + deterministic gate + hard-stop trace mapping vs EXECUTOR_LOG.md",
    )
    .option("--mission <path>", "Mission file (.md or .yaml)")
    .option("--changed-missions", "Verify all mission files changed vs base ref on current branch")
    .option("--base-ref <ref>", "Base ref for --changed-missions (default: origin/main or main)")
    .option("--executor-log <path>", "Override EXECUTOR_LOG.md path")
    .option("--cwd <dir>", "Working directory for gate command")
    .option("--fuzzy-trace", "Force content-based anchor matching for all numeric anchors")
    .option("--strict-trace", "Disable auto line-drift resolution (strict line numbers only)")
    .option("--skip-stale-evidence", "Skip TMVC stale-evidence binding for committed PASS trace lines")
    .option("--ci", "Authoritative mode: fail-closed on KPI report stale evidence (use in CI)")
    .option("--pre-push", "Pre-push handoff: git-proof only for legislative stubs; full verify otherwise")
    .option("--break-glass", "Skip all verify gates when GXT_BYPASS_SECRET is authorized")
    .option("--reason <text>", "Mandatory break-glass reason (min 10 characters)")
    .option("--commit <sha>", "Git commit to attach break-glass note (default HEAD)")
    .option("--audit-commit", "Write break-glass audit as empty commit instead of git note")
    .option("--fix", "Interactive remediation on failure (human output only; cannot combine with --json)")
    .option("--non-interactive", "With --fix: print structured hints without prompts")
    .option("--json", "Emit structured JSON (alias for --format json). Incompatible with --fix.")
    .option("--format <fmt>", "Export format: json | sarif | junit")
    .option(
      "--scan-depth <number>",
      "Max commits to scan for Planner [MSN-XXXX] stamp (default: 200, env: GXT_MSN_SCAN_DEPTH)",
    )
    .option("--audience <role>", "Tailor output: executor|planner|verifier|platform")
    .action(async (opts: VerifyCliOptions) => {
      await runVerify(verifyOptionsFromCli(opts));
    });

  program
    .command("scan")
    .description("Run llm_verifiers and write committed KPI report JSON for verify kpi_gate")
    .requiredOption("--mission <path>", "Mission file with llm_verifiers configured")
    .option("--cwd <dir>", "Working directory for verifier commands")
    .option("--json", "Emit structured JSON")
    .action((opts: { mission: string; cwd?: string; json?: boolean }) => {
      runScan(opts);
    });

  program
    .command("register")
    .description("AST discovery: propose skill scope from folder imports/exports (does not mutate MANIFEST)")
    .argument("<dir>", "Repo-relative directory to analyze")
    .option("--skill-key <key>", "Override suggested skill_key")
    .option("--json", "Emit proposal JSON")
    .action((dir: string, opts: { skillKey?: string; json?: boolean }) => {
      runRegister({ dir, skillKey: opts.skillKey, json: opts.json });
    });

  program
    .command("check-imports")
    .description("Deterministic AST import ban check for a folder (usable as gate_command)")
    .argument("<dir>", "Repo-relative directory to scan")
    .requiredOption("--ban <specifier...>", "Banned import specifier (repeatable)")
    .option("--json", "Emit structured JSON")
    .action((dir: string, opts: { ban: string[]; json?: boolean }) => {
      runCheckImports({ dir, ban: opts.ban, json: opts.json });
    });

  program
    .command("perimeter")
    .description("Check protected governance files; local advisory, --ci requires verified signatures")
    .option("--base-ref <ref>", "Base ref for change detection (default: origin/main or main)")
    .option("--ci", "Authoritative CI mode: fail on unsigned protected-file commits")
    .option("--json", "Emit structured JSON")
    .action((opts: { baseRef?: string; ci?: boolean; json?: boolean }) => {
      runPerimeter(opts);
    });

  program
    .command("metrics")
    .description(
      "Git-native governance metrics (path-touch proxy classification; no local event ledger)",
    )
    .option("--json", "Emit stable JSON summary (includes gxt_extension_metadata)")
    .option("--ref <name>", "Git ref to analyze (default HEAD)", "HEAD")
    .action((opts: { json?: boolean; ref?: string }) => {
      runMetrics({ json: opts.json, ref: opts.ref });
    });
}
