import { cageRuleSource, type CageRuleId, type CageRuleSource } from "./cage-rules.js";
import type { CageOutcome, CageResolvedChange } from "./cage-revert.js";

export const CAGE_REPORT_SCHEMA = "gantry.cage-report.v1" as const;

/** Limits with `--no-watch` (after-exit check only), stated in every such report. */
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

/** Limits in watch mode (the default): live restore, not prevention. */
export const CAGE_WATCH_LIMITS: readonly string[] = [
  "restores protected-path writes about once per watch interval while the command runs; it does not block them",
  "a change can be committed or used before the next check; the push guard covers git push from inside the session only",
  "reads are not detected: the command can still read .env and other secrets",
  "network and API side effects are not detected",
  "writes outside the protected set, and outside the repository, are not checked",
];

/** One-line stderr form of {@link CAGE_WATCH_LIMITS}. */
export const CAGE_WATCH_LIMITS_SUMMARY =
  "live restore, not blocking; reads, network calls and writes outside the protected set are not detected";

/** Printed once under a violation report: the path from cage to project-specific missions. */
export const CAGE_UPGRADE_FOOTER =
  "Need project-specific boundaries or task contracts? Run: npx -p @jeger-ai/opengantry gantry init";

export type CageStatus = "ok" | "violations_reverted" | "violations_unresolved" | "runtime_error";

/** One changed protected path. Digests and outcomes only; never file bodies (ADR-0034). */
export interface CageReportChange {
  path: string;
  kind: "added" | "modified" | "deleted";
  rule: CageRuleId;
  source: CageRuleSource;
  /** A revert rule downgraded to report by `--allow-override`. */
  overridden: boolean;
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
  /** `.cage.yaml` at the cage root: whether it exists and how many protect entries it adds. */
  cage_config: { present: boolean; entries: number };
  /** Paths downgraded from revert to report for this run by `--allow-override`. */
  overrides: string[];
  changes: CageReportChange[];
  watch: {
    enabled: boolean;
    interval_ms: number | null;
    live_restores: number;
    contested: string[];
    session_log: string | null;
  };
  push_guard: { enabled: boolean; refused_pushes: number };
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
  cageConfig: CageReport["cage_config"];
  overrides: readonly string[];
  changes: readonly CageResolvedChange[];
  watch: CageReport["watch"];
  pushGuard: CageReport["push_guard"];
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
    cage_config: input.cageConfig,
    overrides: [...input.overrides],
    changes: input.changes.map((c) => ({
      path: c.rel,
      kind: c.kind,
      rule: c.rule,
      source: cageRuleSource(c.rule),
      overridden: c.overridden,
      sha256_before: c.before?.sha256 ?? null,
      sha256_after: c.after?.sha256 ?? null,
      outcome: c.outcome,
      error_code: c.errorCode,
    })),
    watch: input.watch,
    push_guard: input.pushGuard,
    limits: input.watch.enabled ? CAGE_WATCH_LIMITS : CAGE_LIMITS,
  };
}

function changeLine(c: CageReportChange): string {
  const err = c.error_code ? ` ${c.error_code}` : "";
  const over = c.overridden ? ", overridden" : "";
  return `  ${c.outcome.padEnd(13)} ${c.kind.padEnd(8)} ${c.path} (${c.rule}${over})${err}`;
}

/** Stderr banner for `--allow-override`, printed at start and again in the exit summary. */
export function formatCageOverrideBanner(overrides: readonly string[]): string | null {
  if (overrides.length === 0) return null;
  return `cage: OVERRIDE (--allow-override): changes are reported, not restored, under: ${overrides.join(", ")}`;
}

function sessionLines(report: CageReport): string[] {
  const out: string[] = [];
  const w = report.watch;
  if (w.live_restores > 0) {
    out.push(`cage: restored ${String(w.live_restores)} protected change(s) during the session`);
  }
  if (w.contested.length > 0) {
    out.push(`cage: contested (kept being rewritten; restored once at exit): ${w.contested.join(", ")}`);
  }
  if (report.push_guard.refused_pushes > 0) {
    out.push(`cage: refused ${String(report.push_guard.refused_pushes)} push(es) touching protected paths`);
  }
  if (w.session_log && (w.live_restores > 0 || report.push_guard.refused_pushes > 0)) {
    out.push(`cage: session log: ${w.session_log}`);
  }
  return out;
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
  lines.push(...sessionLines(report));
  const banner = formatCageOverrideBanner(report.overrides);
  if (banner) lines.push(banner);
  const summary = report.watch.enabled ? CAGE_WATCH_LIMITS_SUMMARY : CAGE_LIMITS_SUMMARY;
  lines.push(`cage: exit ${String(report.exit_code)}; limits: ${summary}`);
  if (report.status === "violations_reverted" || report.status === "violations_unresolved") {
    lines.push(`cage: ${CAGE_UPGRADE_FOOTER}`);
  }
  return lines;
}
