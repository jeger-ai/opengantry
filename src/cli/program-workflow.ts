import { EXIT_CODE } from "#core/exit-codes.js";
import { Option, type Command } from "commander";
import { runLegislate } from "./flows/legislate.js";
import { runLegislateFromIntent, type FromIntentOptions } from "./flows/legislate-from-intent.js";
import { isGantryUserError, errorMessage } from "#core/user-error.js";
import { runVerify } from "./commands/verify.js";
import { registerVerifyContractOptions, runVerifyContractCommand, type VerifyContractCliOptions } from "./commands/verify-contract.js";
import { registerAdaptCommand } from "./commands/adapt.js";
import type { VerifyOptions } from "./flows/verify-options.js";
import { runPerimeter } from "./commands/perimeter.js";
import { runInterrogateCommand, type InterrogateCliOptions } from "./commands/interrogate.js";
import type { InterrogationRow } from "#core/interrogation.js";
import fs from "node:fs";
import { logError, readStdinIfEmpty, setExitCode } from "./output/cli-io.js";
import { GATE_ADAPTER_IDS } from "#core/gate-adapter.js";
import { currentReporter } from "./output/reporter.js";

/** Commander-parsed legislate flags: --path is `path`; the intent text is a positional argument. */
type LegislateCliOptions = Omit<FromIntentOptions, "intent"> & { path?: string[]; interrogationFile?: string };

export function mapLegislateCommanderOptions(options: LegislateCliOptions, intent: string): FromIntentOptions {
  const file = options.interrogationFile?.trim();
  const interrogation = file ? { source: "operator_file" as const, rows: JSON.parse(fs.readFileSync(file, "utf8")) as InterrogationRow[] } : undefined;
  return { ...options, intent, paths: options.path ?? [], interrogation };
}

/** Commander-parsed verify flags; the renamed and coerced ones are mapped by verifyOptionsFromCli. */
type VerifyCliOptions = Omit<VerifyOptions, "format" | "scanDepth" | "audience"> & {
  format?: string;
  scanDepth?: string;
  reason?: string;
  commit?: string;
  nonInteractive?: boolean;
  export?: string;
};

function parseVerifyExportFormat(raw?: string): VerifyOptions["format"] {
  if (!raw?.trim()) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "text") return undefined;
  if (v === "json" || v === "sarif" || v === "junit") return v;
  throw new Error(`gantry verify: --format must be text, json, sarif, or junit (got ${raw})`);
}

export function verifyOptionsFromCli(opts: VerifyCliOptions): VerifyOptions {
  const scanDepth = Number.parseInt(opts.scanDepth ?? "", 10);
  return {
    ...opts,
    format: parseVerifyExportFormat(opts.format),
    scanDepth: scanDepth > 0 ? scanDepth : undefined,
    breakGlassReason: opts.reason,
    breakGlassCommit: opts.commit,
    fixNonInteractive: opts.nonInteractive,
    audience: currentReporter().audience,
    exportPath: opts.export,
    requireInterrogation: opts.requireInterrogation === true || opts.ci === true || process.env.GANTRY_REQUIRE_INTERROGATION === "1",
  };
}

/** The intent words, else stdin; a usage error when both are empty. */
async function intentText(parts: string[], verb: string): Promise<string | undefined> {
  const text = await readStdinIfEmpty(parts.join(" ").trim());
  if (text) return text;
  logError(`${verb}: provide intent text or pipe stdin`);
  setExitCode(EXIT_CODE.USAGE);
  return undefined;
}

async function legislate(intentParts: string[], options: LegislateCliOptions): Promise<void> {
  const text = await intentText(intentParts, "legislate");
  if (!text) return;
  const mapped = mapLegislateCommanderOptions(options, text);
  try {
    const result = options.fromIntent === true || options.contractFile?.trim() ? await runLegislateFromIntent(mapped) : runLegislate(mapped);
    if (!result.ok) setExitCode(result.exitCode);
  } catch (e) {
    logError(isGantryUserError(e) ? e.message : errorMessage(e));
    setExitCode(isGantryUserError(e) ? e.exitCode : 2);
  }
}

export function registerWorkflowCommands(program: Command): void {
  program
    .command("legislate")
    .description("Scaffold YAML mission under .gitagent/missions/ using explicit MSN (Planner still commits)")
    .argument("[intent...]", "One-line Planner intent summary")
    .requiredOption("--msn <id>", "Explicit mission id (must match MSN-0007)")
    .option("--skill-key <key>", "Override the manifest-derived skill_key when triage escalates")
    .option("--allow-duplicate", "Allow duplicate msn_id only for intentional branch migrations")
    .option("--out <file>", "Output path (.gitagent/missions/…); defaults to MSN.slug.yaml")
    .option("--gate-command <cmd>", "Deterministic gate command (quote the full shell string if it contains spaces)")
    .option("--gate-success-substring <text>", "Optional substring required in combined gate stdout/stderr")
    .addOption(
      new Option("--gate-adapter <id>", "Explicit gate output parser: generic (default) | eslint (gate must emit --format json) | tsc").choices([
        ...GATE_ADAPTER_IDS,
      ]),
    )
    .option("--path <paths...>", "Declared paths for gap analysis (repeatable)")
    .option("--interrogation-file <file>", "JSON file with interrogation answers (token-less path)")
    .option("--from-intent", "Propose a mission contract from intent + repo, then prompt for approval")
    .option("--yes", "Approve the proposed contract without a TTY prompt (required for non-TTY --from-intent)")
    .option("--contract-file <file>", "YAML file with a contract: block (skips propose prompt)")
    .action(legislate);

  program
    .command("interrogate")
    .description("Deterministic gap analysis before legislation (one question at a time)")
    .argument("[intent...]", "Planner intent summary")
    .option("--msn <id>", "Mission id (advisory label)")
    .option("--skill-key <key>", "Manifest skill_key")
    .option("--gate-command <cmd>", "Proposed gate command")
    .option("--gate-success-substring <text>", "Proposed gate success substring")
    .option("--path <paths...>", "Declared paths for boundary analysis")
    .option("--answers <file>", "JSON file with accumulated interrogation answers")
    .option("--json", "Structured JSON output")
    .action(async (intentParts: string[], options: Omit<InterrogateCliOptions, "intent"> & { path?: string[]; answers?: string }) => {
      const intent = await intentText(intentParts, "interrogate");
      if (intent) runInterrogateCommand({ ...options, intent, paths: options.path ?? [], answersFile: options.answers });
    });

  const verify = program
    .command("verify")
    .description("Git-proof (Planner + MSN) + deterministic gate + hard-stop trace mapping vs EXECUTOR_LOG.md")
    .option("--mission <path>", "Mission file (.md or .yaml)")
    .option("--changed-missions", "Verify all mission files changed vs base ref on current branch")
    .option("--base-ref <ref>", "Base ref for --changed-missions (default: origin/main or main)")
    .option("--executor-log <path>", "Override EXECUTOR_LOG.md path")
    .option("--cwd <dir>", "Working directory for gate command")
    .option("--fuzzy-trace", "Force content-based anchor matching for all numeric anchors")
    .option("--strict-trace", "Disable auto line-drift resolution (strict line numbers only)")
    .option("--skip-stale-evidence", "Skip TMVC stale-evidence binding for committed PASS trace lines")
    .option("--record", "After a full pass on a clean committed tree, write .gitagent/runs/<MSN>.json as the mission evidence; commit it")
    .option("--ci", "Authoritative mode: fail-closed on perimeter and interrogation checks (use in CI)")
    .option("--require-interrogation", "Require interrogation block on mission (also default when --ci)")
    .option("--pre-push", "Pre-push handoff: git-proof only for legislative stubs; full verify otherwise")
    .option("--break-glass", "Skip all verify gates when GANTRY_BYPASS_SECRET is authorized")
    .option("--reason <text>", "Mandatory break-glass reason (min 10 characters)")
    .option("--commit <sha>", "Git commit to attach break-glass note (default HEAD)")
    .option("--audit-commit", "Write break-glass audit as empty commit instead of git note")
    .option("--fix", "Interactive remediation on failure (human output only; cannot combine with --json)")
    .option("--non-interactive", "With --fix: print structured hints without prompts")
    .option("--json", "Emit structured JSON (alias for --format json). Incompatible with --fix.")
    .option("--json-out <path>", "Write structured JSON payload to file (pipe-safe; no stdout JSON)")
    .option("--format <fmt>", "Export format: text (default) | json | sarif | junit")
    .option("--scan-depth <number>", "Max commits to scan for Planner [MSN-XXXX] stamp (default: 200, env: GANTRY_MSN_SCAN_DEPTH)")
    .option("--export <file>", "After a pass with a run record, write the export envelope 2.0 over the record")
    .option("--audience <role>", "Tailor output: executor|planner|verifier|platform");
  registerVerifyContractOptions(verify).action(async (opts: VerifyCliOptions & Partial<VerifyContractCliOptions>) => {
    await (opts.contract !== undefined ? runVerifyContractCommand({ ...opts, contract: opts.contract }) : runVerify(verifyOptionsFromCli(opts)));
  });

  registerAdaptCommand(program);

  program
    .command("perimeter")
    .description("Governance perimeter: protected-file guard")
    .option("--base-ref <ref>", "Base ref for change detection (default: origin/main or main)")
    .option("--ci", "Authoritative CI mode: fail on unsigned protected-file commits")
    .option("--json", "Emit structured JSON")
    .action(runPerimeter);
}
