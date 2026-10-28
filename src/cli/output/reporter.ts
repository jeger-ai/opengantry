import { CLI_NAME } from "#core/constants.js";
import { audienceSectionTitle, filterTaggedStepsForAudience, formatAudienceNextStep, resolveAudience, type AudienceNextStep } from "./audience-output.js";
import type { OutputAudience } from "#missions/mission-verify/hints.js";

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
    return new Reporter(mode, options.audience);
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

  /** A next-steps block for this audience: the section title when the audience has one, else `fallback`. */
  nextSteps(fallback: string, steps: readonly string[], tagged?: readonly AudienceNextStep[]): void {
    const filtered = tagged && tagged.length > 0 ? filterTaggedStepsForAudience(this.audience, [...tagged]) : [...steps];
    const lines = filtered.map((step) => formatAudienceNextStep(step, this.audience));
    const section = audienceSectionTitle(this.audience);
    this.info(`${section && lines.length > 0 ? section : fallback}:`);
    for (const line of lines) this.info(`  ${line}`);
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

/** Make reporter the current one (the entry point and the Commander hook do, once per command). */
export function setReporter(reporter: Reporter): void {
  current = reporter;
}

/** Back to a plain human reporter (process start; after each command, so commands run in one process do not leak). */
export function resetReporter(): void {
  current = new Reporter();
}

export interface ReporterArgv {
  audience?: string;
  json?: boolean;
  format?: string;
}

/**
 * The reporter for a command invocation. Precedence for the audience: --audience, then GANTRY_AUDIENCE. A
 * --format of json, sarif or junit, or --json, selects a structured mode; any other --format is a human
 * document.
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
