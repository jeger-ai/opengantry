import type { CageRuleId } from "./cage-rules.js";
import type { CageOutcome, CageResolvedChange } from "./cage-revert.js";

export const CAGE_REPORT_SCHEMA = "gantry.cage-report.v1" as const;

/** Detect-after-the-fact limits, stated in every cage report. */
export const CAGE_LIMITS: readonly string[] = [
  "detects protected-path writes after the command exits; it does not block them while it runs",
  "reads are not detected: the command can still read .env and other secrets",
  "network and API side effects are not detected",
  "writes outside the protected set, and outside the repository, are not checked",
  "background processes that outlive the command can still write after the check",
];

/** One-line stderr form of {@link CAGE_LIMITS}; `--json` keeps the full list. */
export const CAGE_LIMITS_SUMMARY =
  "after-exit check only; reads, network calls and writes outside the protected set are not detected";

/** Printed once under a violation report: the path from cage to project-specific missions. */
export const CAGE_UPGRADE_FOOTER =
  "Need project-specific boundaries or task contracts? Run: npx -p @jeger-ai/opengantry gantry init";

export type CageStatus = "ok" | "violations_reverted" | "violations_unresolved" | "runtime_error";

/** One changed protected path. Digests and outcomes only; never file bodies (ADR-0034). */
export interface CageReportChange {
  path: string;
  kind: "added" | "modified" | "deleted";
  rule: CageRuleId;
  sha256_before: string | null;
  sha256_after: string | null;
  outcome: CageOutcome;
  error_code: string | null;
}

export interface CageReport {
  report_schema: typeof CAGE_REPORT_SCHEMA;
  status: CageStatus;
  exit_code: number;
  /** argv[0] only: arguments can carry tokens. */
  command: string;
  command_exit_code: number | null;
  command_signal: string | null;
  runtime_error: string | null;
  root: string;
  revert_mode: "revert" | "report_only";
  max_file_bytes: number;
  protected_files: number;
  manifest_zones: number;
  changes: CageReportChange[];
  limits: readonly string[];
}

export interface CageReportInput {
  command: string;
  commandExitCode: number | null;
  commandSignal: NodeJS.Signals | null;
  runtimeError: string | null;
  root: string;
  reportOnly: boolean;
  maxFileBytes: number;
  protectedFiles: number;
  manifestZones: number;
  changes: readonly CageResolvedChange[];
  signalExitCode: (signal: NodeJS.Signals) => number;
}

const VIOLATION_EXIT_CODE = 3;
const RUNTIME_ERROR_EXIT_CODE = 2;
const RESOLVED_OUTCOMES: ReadonlySet<CageOutcome> = new Set(["reverted", "removed"]);

function cageStatus(input: CageReportInput): CageStatus {
  const violations = input.changes.filter((c) => c.mode === "revert");
  if (violations.length > 0) {
    return violations.every((c) => RESOLVED_OUTCOMES.has(c.outcome)) ? "violations_reverted" : "violations_unresolved";
  }
  return input.runtimeError ? "runtime_error" : "ok";
}

function cageExitCode(status: CageStatus, input: CageReportInput): number {
  if (status === "violations_reverted" || status === "violations_unresolved") return VIOLATION_EXIT_CODE;
  if (status === "runtime_error") return RUNTIME_ERROR_EXIT_CODE;
  if (input.commandSignal) return input.signalExitCode(input.commandSignal);
  return input.commandExitCode ?? RUNTIME_ERROR_EXIT_CODE;
}

export function buildCageReport(input: CageReportInput): CageReport {
  const status = cageStatus(input);
  return {
    report_schema: CAGE_REPORT_SCHEMA,
    status,
    exit_code: cageExitCode(status, input),
    command: input.command,
    command_exit_code: input.commandExitCode,
    command_signal: input.commandSignal,
    runtime_error: input.runtimeError,
    root: input.root,
    revert_mode: input.reportOnly ? "report_only" : "revert",
    max_file_bytes: input.maxFileBytes,
    protected_files: input.protectedFiles,
    manifest_zones: input.manifestZones,
    changes: input.changes.map((c) => ({
      path: c.rel,
      kind: c.kind,
      rule: c.rule,
      sha256_before: c.before?.sha256 ?? null,
      sha256_after: c.after?.sha256 ?? null,
      outcome: c.outcome,
      error_code: c.errorCode,
    })),
    limits: CAGE_LIMITS,
  };
}

function changeLine(c: CageReportChange): string {
  const err = c.error_code ? ` ${c.error_code}` : "";
  return `  ${c.outcome.padEnd(13)} ${c.kind.padEnd(8)} ${c.path} (${c.rule})${err}`;
}

/** Human summary (stderr), so it never mixes into the wrapped command's stdout. */
export function formatCageReport(report: CageReport): string[] {
  const lines: string[] = [];
  const n = report.changes.length;
  if (report.runtime_error) lines.push(`cage: command did not run: ${report.runtime_error}`);
  if (n === 0) {
    lines.push(`cage: ${report.status} — ${String(report.protected_files)} protected file(s) unchanged`);
  } else {
    lines.push(`cage: ${report.status} — ${String(n)} protected change(s)`);
    for (const c of report.changes) lines.push(changeLine(c));
  }
  if (report.changes.some((c) => c.outcome === "detect_only")) {
    lines.push(
      `cage: detect_only files exceeded the ${String(report.max_file_bytes)}-byte per-file cap or the total snapshot budget and were not restored`,
    );
  }
  lines.push(`cage: exit ${String(report.exit_code)}; limits: ${CAGE_LIMITS_SUMMARY}`);
  if (report.status === "violations_reverted" || report.status === "violations_unresolved") {
    lines.push(`cage: ${CAGE_UPGRADE_FOOTER}`);
  }
  return lines;
}
