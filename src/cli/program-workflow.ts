import { EXIT_CODE } from "#core/exit-codes.js";
import { Option, type Command } from "commander";
import { runAttest } from "./commands/attest.js";
import { runLegislate, type LegislateOptions } from "./flows/legislate.js";
import { runLegislateFromIntent } from "./flows/legislate-from-intent.js";
import { isGantryUserError, errorMessage } from "#core/user-error.js";
import { runVerify } from "./commands/verify.js";
import { registerVerifyContractOptions, runVerifyContractCommand, type VerifyContractCliOptions } from "./commands/verify-contract.js";
import { registerAdaptCommand } from "./commands/adapt.js";
import type { VerifyOptions } from "./flows/verify-options.js";
import type { VerifyExportFormat } from "#missions/mission-verify/export.js";
import { runEventsPush } from "./commands/events-push.js";
import { runPerimeter } from "./commands/perimeter.js";
import { runArchCheckCommand } from "./commands/arch.js";
import { runInterrogateCommand, type InterrogateCliOptions } from "./commands/interrogate.js";
import type { InterrogationRow } from "#core/interrogation.js";
import fs from "node:fs";
import { logError, readStdinIfEmpty, setExitCode } from "./output/cli-io.js";
import { GATE_ADAPTER_IDS, type GateAdapterId } from "#core/gate-adapter.js";
import { currentReporter } from "./output/reporter.js";

/** Commander-parsed legislate flags (intent text is a positional arg). */
type LegislateCliOptions = Omit<LegislateOptions, "intent" | "silent" | "interrogation" | "paths" | "contract"> & {
  path?: string[];
  interrogationFile?: string;
  fromIntent?: boolean;
  yes?: boolean;
  contractFile?: string;
};

/** Commander maps --path to `path` and --answers to `answers`. */
export type InterrogateCommanderOptions = Omit<
  InterrogateCliOptions,
  "intent" | "paths" | "answersFile"
> & {
  path?: string[];
  answers?: string;
};

export function mapInterrogateCommanderOptions(
  options: InterrogateCommanderOptions,
  intent: string,
): InterrogateCliOptions {
  return {
    intent,
    msn: options.msn,
    skillKey: options.skillKey,
    gateCommand: options.gateCommand,
    gateSuccessSubstring: options.gateSuccessSubstring,
    paths: options.path ?? [],
    answersFile: options.answers,
    json: options.json,
  };
}

export function mapLegislateCommanderOptions(
  options: LegislateCliOptions,
  intent: string,
): LegislateOptions {
  let interrogation: LegislateOptions["interrogation"] | undefined;
  if (options.interrogationFile?.trim()) {
    const raw = fs.readFileSync(options.interrogationFile.trim(), "utf8");
    const rows = JSON.parse(raw) as InterrogationRow[];
    interrogation = {
      source: "operator_file",
      rows,
    };
  }
  return {
    ...options,
    intent,
    paths: options.path ?? [],
    interrogation,
    gateAdapter: options.gateAdapter as GateAdapterId | undefined,
  };
}

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
  record?: boolean;
  ci?: boolean;
  requireInterrogation?: boolean;
  prePush?: boolean;
  breakGlass?: boolean;
  reason?: string;
  commit?: string;
  auditCommit?: boolean;
  fix?: boolean;
  nonInteractive?: boolean;
  json?: boolean;
  jsonOut?: string;
  format?: string;
  audience?: string;
  scanDepth?: string;
  receipt?: string | boolean;
  signReceipt?: boolean;
  export?: string;
}

function parseVerifyExportFormat(raw?: string): VerifyExportFormat | undefined {
  if (!raw?.trim()) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "text") return undefined;
  if (v === "json" || v === "sarif" || v === "junit") return v;
  throw new Error(`gantry verify: --format must be text, json, sarif, or junit (got ${raw})`);
}

export function verifyOptionsFromCli(opts: VerifyCliOptions): VerifyOptions {
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
    record: opts.record,
    ci: opts.ci,
    prePush: opts.prePush,
    breakGlass: opts.breakGlass,
    auditCommit: opts.auditCommit,
    fix: opts.fix,
    json: opts.json,
    jsonOut: opts.jsonOut,
    format,
    scanDepth: Number.isFinite(scanDepth) && scanDepth! > 0 ? scanDepth : undefined,
    breakGlassReason: opts.reason,
    breakGlassCommit: opts.commit,
    fixNonInteractive: opts.nonInteractive,
    audience: currentReporter().audience,
    receipt: opts.receipt,
    signReceipt: opts.signReceipt,
    exportPath: opts.export,
    requireInterrogation:
      opts.requireInterrogation === true ||
      opts.ci === true ||
      process.env.GANTRY_REQUIRE_INTERROGATION === "1",
  };
}

function registerLegislateCommand(program: Command): void {
  program
    .command("legislate")
    .description("Scaffold YAML mission under .gitagent/missions/ using explicit MSN (Planner still commits)")
    .argument("[intent...]", "One-line Planner intent summary")
    .requiredOption("--msn <id>", "Explicit mission id (must match MSN-0007)")
    .option("--skill-key <key>", "Override the manifest-derived skill_key when triage escalates")
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
    .addOption(
      new Option(
        "--gate-adapter <id>",
        "Explicit gate output parser: generic (default) | eslint (gate must emit --format json) | tsc",
      ).choices([...GATE_ADAPTER_IDS]),
    )
    .option("--path <paths...>", "Declared paths for gap analysis (repeatable)")
    .option("--interrogation-file <file>", "JSON file with interrogation answers (token-less path)")
    .option("--from-intent", "Propose a mission contract from intent + repo, then prompt for approval")
    .option("--yes", "Approve the proposed contract without a TTY prompt (required for non-TTY --from-intent)")
    .option("--contract-file <file>", "YAML file with a contract: block (skips propose prompt)")
    .action(async (intentParts: string[], options: LegislateCliOptions, _cmd: Command) => {
      let text = intentParts.join(" ").trim();
      text = await readStdinIfEmpty(text);
      if (!text) {
        logError("legislate: provide intent text or pipe stdin");
        setExitCode(EXIT_CODE.USAGE);
        return;
      }
      const mapped = mapLegislateCommanderOptions(options, text);
      const fromIntent = options.fromIntent === true || Boolean(options.contractFile?.trim());
      try {
        const result = fromIntent
          ? await runLegislateFromIntent({
              ...mapped,
              fromIntent: options.fromIntent === true,
              yes: options.yes === true,
              contractFile: options.contractFile,
            })
          : runLegislate(mapped);
        if (!result.ok) setExitCode(result.exitCode);
      } catch (e) {
        logError(isGantryUserError(e) ? e.message : errorMessage(e));
        setExitCode(isGantryUserError(e) ? e.exitCode : 2);
      }
    });
}

function registerInterrogateCommand(program: Command): void {
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
    .action(async (intentParts: string[], options: InterrogateCommanderOptions) => {
      let text = intentParts.join(" ").trim();
      text = await readStdinIfEmpty(text);
      if (!text) {
        logError("interrogate: provide intent text or pipe stdin");
        setExitCode(EXIT_CODE.USAGE);
        return;
      }
      runInterrogateCommand(mapInterrogateCommanderOptions(options, text));
    });
}

function registerAttestCommand(program: Command): void {
  program
    .command("attest")
    .description("Emit local attestation receipt (digests only; optional SSH/GPG signature)")
    .argument("[mission]", "Mission file (.md or .yaml); alias for --mission when npm run swallows flags")
    .option("--mission <path>", "Mission file (.md or .yaml)")
    .option("--out <file>", "Receipt output path (default .gitagent/history/receipts/)")
    .option("--export <file>", "Write hub export envelope (payload_b64 + signature)")
    .option("--sign", "Detach-sign receipt with local SSH/GPG key")
    .option("--json", "Emit structured JSON including receipt_path")
    .action(
      (
        missionPositional: string | undefined,
        opts: { mission?: string; out?: string; export?: string; sign?: boolean; json?: boolean },
      ) => {
        runAttest({
          mission: opts.mission ?? missionPositional,
          out: opts.out,
          exportPath: opts.export,
          sign: opts.sign,
          json: opts.json,
        });
      },
    );
}

function registerVerifyCommand(program: Command): void {
  const cmd = program
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
    .option(
      "--scan-depth <number>",
      "Max commits to scan for Planner [MSN-XXXX] stamp (default: 200, env: GANTRY_MSN_SCAN_DEPTH)",
    )
    .option("--receipt [file]", "Write attestation receipt JSON after verify (default history path)")
    .option("--sign-receipt", "Detach-sign receipt with local SSH/GPG key")
    .option("--export <file>", "Write hub export envelope after verify (payload_b64 + signature)")
    .option("--audience <role>", "Tailor output: executor|planner|verifier|platform");
  registerVerifyContractOptions(cmd);
  cmd.action(async (opts: VerifyCliOptions & Omit<VerifyContractCliOptions, "contract" | "mission" | "json" | "format"> & { contract?: string | true }) => {
      if (opts.contract !== undefined) {
        await runVerifyContractCommand({ ...opts, contract: opts.contract });
        return;
      }
      await runVerify(verifyOptionsFromCli(opts));
    });
}

function registerEventsCommand(program: Command): void {
  const eventsCmd = program.command("events").description("Pre-commit agent event spool and plane push");

  eventsCmd
    .command("push")
    .description("Push spooled pre-commit events to opengantry-plane")
    .option("--url <url>", "Plane ingest base URL (default PLANE_INGEST_URL)")
    .option("--token <token>", "Ingest bearer token (default PLANE_INGEST_TOKEN)")
    .option("--dry-run", "Print batch envelope without sending")
    .option("--json", "Emit structured JSON")
    .option("--cwd <dir>", "Working directory")
    .action(async (opts: { url?: string; token?: string; dryRun?: boolean; json?: boolean; cwd?: string }) => {
      await runEventsPush(opts);
    });
}

function registerPerimeterCommand(program: Command): void {
  const perimeterCmd = program
    .command("perimeter")
    .description("Governance perimeter: protected-file guard (default) and TARGET_ARCHITECTURE checks");

  perimeterCmd
    .command("check")
    .description("Evaluate TARGET_ARCHITECTURE.yaml rules (domain-neutral alias of arch check)")
    .argument("[files...]", "Repo-relative or absolute paths (default: all files under scan_roots)")
    .option("--json", "Emit structured violation JSON")
    .action((files: string[], opts: { json?: boolean }) => {
      runArchCheckCommand({ files, json: opts.json === true, label: "perimeter" });
    });

  perimeterCmd
    .option("--base-ref <ref>", "Base ref for change detection (default: origin/main or main)")
    .option("--ci", "Authoritative CI mode: fail on unsigned protected-file commits")
    .option("--json", "Emit structured JSON")
    .action((opts: { baseRef?: string; ci?: boolean; json?: boolean }) => {
      runPerimeter(opts);
    });
}

export function registerWorkflowCommands(program: Command): void {
  registerLegislateCommand(program);
  registerInterrogateCommand(program);
  registerAttestCommand(program);
  registerVerifyCommand(program);
  registerAdaptCommand(program);
  registerEventsCommand(program);
  registerPerimeterCommand(program);
}
