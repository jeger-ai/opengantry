import { CLI_NAME } from "./constants.js";
import {
  audienceSectionTitle,
  filterTaggedStepsForAudience,
  formatAudienceNextStep,
  resolveAudience,
  type OutputAudience,
} from "./audience-output.js";
import type { VerifyPhaseSuccess } from "./verify/verify-engine.js";
import type { VerifyFailurePresentation } from "./verify/verify-failure-normalize.js";
import type { AudienceTaggedStep } from "./verify/verify-hints.js";

/** human: the report is the document. json, sarif, junit: stdout carries only the document. */
export type ReporterMode = "human" | "json" | "sarif" | "junit";

const STRUCTURED_MODES: readonly string[] = ["json", "sarif", "junit"];
const GXT_ERROR_PREFIX_RE = /\[GXT_[A-Z0-9_]+\]/;

/**
 * The output layer (ADR-0052 A7). One reporter per command run: the document goes to stdout, diagnostics to
 * stderr. In human mode the report is the document, so info lines go to stdout and warnings and errors to
 * stderr; in a structured mode every diagnostic goes to stderr so stdout stays a parseable document. The
 * audience is a presenter parameter: the verifier audience sees only diagnostics that carry a GXT code.
 */
export class Reporter {
  constructor(
    readonly mode: ReporterMode = "human",
    readonly audience: OutputAudience | undefined = undefined,
  ) {}

  /** The reporter of a verify run: --format or --json pick the mode, --audience the presenter. */
  static forVerify(options: { json?: boolean; format?: string; audience?: OutputAudience }): Reporter {
    const mode = structuredMode(options.format) ?? (options.json === true ? "json" : "human");
    return new Reporter(mode, options.audience ?? currentReporter().audience);
  }

  get structured(): boolean {
    return this.mode !== "human";
  }

  /** The pipeline payload: stdout, always. */
  document(text: string): void {
    console.log(text);
  }

  info(message: string): void {
    if (this.structured) {
      console.error(message);
      return;
    }
    if (this.audience === "verifier") return;
    console.log(message);
  }

  warn(message: string): void {
    if (!this.structured && this.audience === "verifier") return;
    console.error(`${CLI_NAME}: warning: ${message}`);
  }

  error(message: string): void {
    if (!this.structured && this.audience === "verifier" && !GXT_ERROR_PREFIX_RE.test(message)) return;
    console.error(`${CLI_NAME}: ${message}`);
  }

  /** Human remediation only; never part of a machine document. */
  fixHint(hint: string): void {
    this.info(`Fix: ${hint}`);
  }

  /** Report lines: part of the human report, nothing in a structured mode (the document says it). */
  emitInfo(message: string): void {
    if (!this.structured) this.info(message);
  }

  emitError(message: string): void {
    if (!this.structured) this.error(message);
  }

  emitFixHint(hint: string): void {
    if (!this.structured) this.fixHint(hint);
  }

  /** Red stderr for existing managed-asset conflicts (respects NO_COLOR). */
  managedAssetConflicts(conflicts: string[]): void {
    if (!this.structured && this.audience === "verifier") return;
    const useColor = process.env.NO_COLOR === undefined;
    const red = useColor ? "\x1b[31m" : "";
    const reset = useColor ? "\x1b[0m" : "";
    console.error(`${red}${CLI_NAME}: warning: managed files already exist and differ from templates:${reset}`);
    for (const rel of conflicts) {
      console.error(`${red}  - ${rel}${reset}`);
    }
  }

  emitVerifySuccess(result: VerifyPhaseSuccess): void {
    if (this.structured) return;
    this.info(`${CLI_NAME} verify: git-proof OK (Planner legislation for ${result.proofMsnId})`);
    for (const w of result.gitProofWarnings ?? []) this.warn(w);
    if (result.outcome === "pre_push_stub") {
      this.info(
        `${CLI_NAME} verify: legislative stub OK (remote handoff; git-proof passed — run full verify after execution)`,
      );
      return;
    }
    this.info(`${CLI_NAME} verify: gate passed`);
    for (const w of result.kpiWarnings ?? []) this.info(`  ${w}`);
    for (const warning of result.traceWarnings) {
      const tag = warning.autoResolved ? "auto-resolved" : "drift";
      this.info(
        `  trace: line ${tag} DoD ${warning.row.dodId} — declared ${String(warning.declaredLine)}, found ${String(warning.foundLine)}`,
      );
    }
    if (result.traceEvidenceSkippedUncommitted !== undefined) {
      this.info(
        `  trace evidence: ${String(result.traceEvidenceSkippedUncommitted)} uncommitted EXECUTOR_LOG line(s) skipped stale check`,
      );
    }
    if (result.runRecordPath) this.info(`${CLI_NAME} verify: run record OK (${result.runRecordPath})`);
    else this.info(`${CLI_NAME} verify: trace mapping OK (${result.executorLogPath})`);
  }

  emitFailurePresentation(presentation: VerifyFailurePresentation): void {
    if (this.structured) return;
    this.error(`[${presentation.error_code}] ${presentation.headline}`);
    for (const line of presentation.detail_lines) {
      this.error(line.startsWith("---") ? line : `  ${line}`);
    }
    for (const hint of presentation.fix_hints) this.fixHint(hint);
    this.emitNextSteps(presentation.next_actions, presentation.tagged_steps);
  }

  emitNextSteps(steps: string[], tagged?: AudienceTaggedStep[]): void {
    if (this.structured) return;
    const filtered = tagged && tagged.length > 0 ? filterTaggedStepsForAudience(this.audience, tagged) : steps;
    const formatted = filtered.map((step) => formatAudienceNextStep(step, this.audience));
    const section = audienceSectionTitle(this.audience);
    this.info(section && formatted.length > 0 ? `${section}:` : "next actions:");
    for (const step of formatted) this.info(`  ${step}`);
  }
}

function structuredMode(format: string | undefined): ReporterMode | undefined {
  if (typeof format !== "string") return undefined;
  const v = format.trim().toLowerCase();
  return STRUCTURED_MODES.includes(v) ? (v as ReporterMode) : undefined;
}

let current = new Reporter();

/** The reporter of the running command (the entry point and the Commander hook set it). */
export function currentReporter(): Reporter {
  return current;
}

/** Replace the current reporter and return the previous one. */
export function setCurrentReporter(reporter: Reporter): Reporter {
  const previous = current;
  current = reporter;
  return previous;
}

/** Back to a plain human reporter (process start; tests that run several commands in one process). */
export function resetReporter(): void {
  current = new Reporter();
}

/** Run fn with reporter current and restore the previous one afterwards, however fn ends. */
export async function withReporter<T>(reporter: Reporter, fn: () => T | Promise<T>): Promise<T> {
  const previous = setCurrentReporter(reporter);
  try {
    return await fn();
  } finally {
    setCurrentReporter(previous);
  }
}

export interface ReporterArgv {
  audience?: string;
  json?: boolean;
  format?: string;
}

/**
 * The reporter for a command invocation. Precedence for the audience: --audience, then GANTRY_AUDIENCE. A
 * --format of json, sarif or junit, or --json, selects a structured mode; any other --format is a human
 * document (gantry report --format html).
 */
export function reporterFromArgv(
  argv: ReporterArgv,
  envAudience = process.env.GANTRY_AUDIENCE,
): { reporter: Reporter } | { invalidAudience: string } {
  const resolved = resolveAudience(argv.audience, envAudience);
  if (resolved.invalidCli) return { invalidAudience: resolved.invalidCli };
  const mode = structuredMode(argv.format) ?? (argv.json === true ? "json" : "human");
  return { reporter: new Reporter(mode, resolved.audience) };
}
