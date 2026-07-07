import fs from "node:fs";
import path from "node:path";
import type { ErrorObject, ValidateFunction } from "ajv";
import YAML from "yaml";
import { createSchemaValidator } from "./ajv-loader.js";
import { REL_KPI_REPORT_SCHEMA } from "./constants.js";
import { toPosixRel } from "./cli-io.js";
import { gitDiffNameOnlySinceCommit, gitRunOk } from "./git.js";
import { readBlamePorcelainByLine, UNCOMMITTED_BLAME_COMMIT } from "./trace.js";
import { tmvcRootsForSkill } from "./tmvc-path.js";
import { isVirtualScratchPath } from "./virtual-scratch-store.js";
import type { KpiGateSpec, KpiReport, KpiThreshold, KpiThresholdOp, Manifest } from "./types.js";
import type { VerifyOptions } from "./verify-engine.js";
import type { VerifyPhaseFailure } from "./verify-engine.js";

let compiledValidator: ValidateFunction | null = null;
let compiledForRoot: string | null = null;

function loadKpiReportSchemaValidator(root: string): ValidateFunction {
  if (compiledValidator && compiledForRoot === root) {
    return compiledValidator;
  }
  const schemaPath = path.join(root, REL_KPI_REPORT_SCHEMA);
  const schemaDoc = YAML.parse(fs.readFileSync(schemaPath, "utf8")) as Record<string, unknown>;
  const validate = createSchemaValidator(schemaDoc);
  compiledValidator = validate;
  compiledForRoot = root;
  return validate;
}

function formatAjvErrors(errors: ErrorObject[]): string {
  return errors
    .map((e) => {
      const at = e.instancePath || "(root)";
      return `${at}: ${e.message ?? "invalid"}`;
    })
    .join("; ");
}

export function assertKpiReportSchemaValid(root: string, data: unknown, filePath: string): void {
  const validate = loadKpiReportSchemaValidator(root);
  if (validate(data)) return;
  const detail = formatAjvErrors(validate.errors ?? []);
  throw new Error(`gantry kpi: ${filePath}: schema validation failed: ${detail}`);
}

export interface KpiThresholdFailure {
  metric: string;
  op: KpiThresholdOp;
  expected: number;
  actual: number | boolean | undefined;
  reason: string;
}

function metricNumericValue(value: number | boolean | undefined): number | null {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function compareThreshold(
  actual: number | boolean | undefined,
  op: KpiThresholdOp,
  expected: number,
): boolean {
  if (op === "==") {
    if (typeof actual === "boolean") {
      const boolExpected = expected === 1 || expected === 0 ? expected === 1 : false;
      return actual === boolExpected;
    }
    if (typeof actual !== "number" || !Number.isFinite(actual)) return false;
    return actual === expected;
  }

  const numeric = metricNumericValue(actual);
  if (numeric === null) return false;

  switch (op) {
    case "<=":
      return numeric <= expected;
    case ">=":
      return numeric >= expected;
    case "<":
      return numeric < expected;
    case ">":
      return numeric > expected;
    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

/** Pure deterministic threshold evaluation over a loaded KPI report. */
export function evaluateKpiThresholds(
  report: KpiReport,
  thresholds: readonly KpiThreshold[],
): KpiThresholdFailure[] {
  const failures: KpiThresholdFailure[] = [];

  for (const threshold of thresholds) {
    const actual = report.metrics[threshold.metric];
    if (actual === undefined) {
      failures.push({
        metric: threshold.metric,
        op: threshold.op,
        expected: threshold.value,
        actual: undefined,
        reason: `metric "${threshold.metric}" missing from KPI report`,
      });
      continue;
    }

    if (!compareThreshold(actual, threshold.op, threshold.value)) {
      failures.push({
        metric: threshold.metric,
        op: threshold.op,
        expected: threshold.value,
        actual,
        reason:
          `KPI threshold failed: ${threshold.metric} ${threshold.op} ${String(threshold.value)} ` +
          `(actual: ${String(actual)})`,
      });
    }
  }

  return failures;
}

export function loadKpiReport(root: string, reportRelPath: string): KpiReport {
  const abs = path.isAbsolute(reportRelPath)
    ? reportRelPath
    : path.join(root, reportRelPath.replace(/\\/g, path.sep));
  if (!fs.existsSync(abs)) {
    throw new Error(`KPI report not found: ${reportRelPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(abs, "utf8")) as unknown;
  assertKpiReportSchemaValid(root, raw, reportRelPath);
  return raw as KpiReport;
}



export interface KpiReportStaleOptions {
  skipStaleEvidence?: boolean;
  /** When true, uncommitted TMVC drift is a hard failure (pre-push / CI). */
  strictStale?: boolean;
}

export interface KpiReportStaleResult {
  stale: boolean;
  advisoryOnly: boolean;
  stalePaths: string[];
  attestationCommit?: string;
  reason?: string;
}

function reportRelPath(reportPath: string, repoRoot: string): string {
  const abs = path.isAbsolute(reportPath) ? reportPath : path.join(repoRoot, reportPath);
  return toPosixRel(repoRoot, abs);
}

function resolveKpiAttestationCommit(
  repoRoot: string,
  reportRel: string,
  blameByLine: Map<number, string>,
): string | undefined {
  if ([...blameByLine.values()].some((hash) => hash === UNCOMMITTED_BLAME_COMMIT)) {
    return UNCOMMITTED_BLAME_COMMIT;
  }
  const log = gitRunOk(repoRoot, ["log", "-1", "--format=%H", "--", reportRel]);
  if (log.ok && log.stdout.trim().length > 0) {
    return log.stdout.trim();
  }
  return blameByLine.get(1);
}

/** Bind KPI report attestation to TMVC drift (mirrors trace-evidence committed/uncommitted split). */
export function verifyKpiReportFreshness(
  repoRoot: string,
  manifest: Manifest,
  skillKey: string | null,
  reportPath: string,
  options: KpiReportStaleOptions = {},
): KpiReportStaleResult {
  if (options.skipStaleEvidence === true) {
    return { stale: false, advisoryOnly: false, stalePaths: [] };
  }

  const reportRel = reportRelPath(reportPath, repoRoot);
  if (isVirtualScratchPath(reportRel)) {
    return {
      stale: false,
      advisoryOnly: false,
      stalePaths: [],
      reason: "virtual scratch KPI report — stale-evidence binding skipped",
    };
  }

  const tmvcRoots = tmvcRootsForSkill(manifest, skillKey);
  if (tmvcRoots.length === 0) {
    return { stale: false, advisoryOnly: false, stalePaths: [] };
  }

  const blameByLine = readBlamePorcelainByLine(repoRoot, reportRel);
  const attestationCommit = resolveKpiAttestationCommit(repoRoot, reportRel, blameByLine);
  if (!attestationCommit) {
    return {
      stale: options.strictStale === true,
      advisoryOnly: options.strictStale !== true,
      stalePaths: [],
      reason: `cannot resolve git blame for KPI report ${reportRel}`,
    };
  }

  if (attestationCommit === UNCOMMITTED_BLAME_COMMIT) {
    return { stale: false, advisoryOnly: true, stalePaths: [], attestationCommit };
  }

  const diffResult = gitDiffNameOnlySinceCommit(repoRoot, attestationCommit, tmvcRoots);
  if (!diffResult.ok) {
    return {
      stale: options.strictStale === true,
      advisoryOnly: options.strictStale !== true,
      stalePaths: [],
      attestationCommit,
      reason: "cannot evaluate TMVC drift since KPI report attestation",
    };
  }

  if (diffResult.paths.length === 0) {
    return { stale: false, advisoryOnly: false, stalePaths: [], attestationCommit };
  }

  const shortCommit = attestationCommit.slice(0, 7);
  const shown = diffResult.paths.slice(0, 5);
  const suffix =
    diffResult.paths.length > shown.length
      ? ` (+${String(diffResult.paths.length - shown.length)} more)`
      : "";
  const reason =
    `KPI report STALE (attested at ${shortCommit}): TMVC drift since scan — ` +
    `${shown.join(", ")}${suffix}. Re-run gantry scan and commit the updated report.`;

  if (options.strictStale === true) {
    return {
      stale: true,
      advisoryOnly: false,
      stalePaths: diffResult.paths,
      attestationCommit,
      reason,
    };
  }

  return {
    stale: false,
    advisoryOnly: true,
    stalePaths: diffResult.paths,
    attestationCommit,
    reason,
  };
}

function loadReportOrFail(
  root: string,
  reportRel: string,
  workerLogPath: string,
): { report: KpiReport } | VerifyPhaseFailure {
  try {
    return { report: loadKpiReport(root, reportRel) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const missing = message.includes("not found");
    return {
      ok: false,
      phase: "kpi",
      message: missing ? `KPI report missing: ${reportRel}` : `KPI report invalid: ${reportRel}`,
      exitCode: 1,
      workerLogPath,
      kpiReportPath: reportRel,
      kpiReason: message,
    };
  }
}

function staleFailure(
  reportRel: string,
  workerLogPath: string,
  stale: ReturnType<typeof verifyKpiReportFreshness>,
): VerifyPhaseFailure {
  return {
    ok: false,
    phase: "kpi",
    message: stale.reason ?? "KPI report stale",
    exitCode: 1,
    workerLogPath,
    kpiReportPath: reportRel,
    kpiReason: stale.reason,
    kpiStalePaths: stale.stalePaths,
  };
}

function thresholdFailure(
  reportRel: string,
  workerLogPath: string,
  first: ReturnType<typeof evaluateKpiThresholds>[number],
): VerifyPhaseFailure {
  return {
    ok: false,
    phase: "kpi",
    message: first.reason,
    exitCode: 1,
    workerLogPath,
    kpiReportPath: reportRel,
    kpiReason: first.reason,
    kpiMetric: first.metric,
    kpiOp: first.op,
    kpiExpected: first.expected,
    kpiActual: first.actual,
  };
}

export type KpiPhaseOutcome =
  | { kind: "ok"; warnings: string[] }
  | { kind: "fail"; failure: VerifyPhaseFailure }
  | null;

export function evaluateKpiPhase(
  root: string,
  manifest: Manifest,
  skillKey: string | null,
  kpiGate: KpiGateSpec,
  options: VerifyOptions,
  workerLogPath: string,
): KpiPhaseOutcome {
  const reportRel = kpiGate.reportPath.replace(/\\/g, "/");
  const loaded = loadReportOrFail(root, reportRel, workerLogPath);
  if ("ok" in loaded) return { kind: "fail", failure: loaded };

  const stale = verifyKpiReportFreshness(root, manifest, skillKey, reportRel, {
    skipStaleEvidence: options.skipStaleEvidence === true,
    strictStale: options.prePush === true || options.ci === true,
  });

  const warnings: string[] = [];
  if (stale.advisoryOnly && stale.reason) {
    warnings.push(`gantry verify: advisory — ${stale.reason}`);
  }
  if (stale.stale) return { kind: "fail", failure: staleFailure(reportRel, workerLogPath, stale) };

  const report = loaded.report;
  const failures = evaluateKpiThresholds(report, kpiGate.thresholds);
  if (failures.length > 0) {
    return { kind: "fail", failure: thresholdFailure(reportRel, workerLogPath, failures[0]!) };
  }

  if (report.exit_code !== 0) {
    return {
      kind: "fail",
      failure: {
        ok: false,
        phase: "kpi",
        message: `KPI report exit_code=${String(report.exit_code)} (expected 0)`,
        exitCode: 1,
        workerLogPath,
        kpiReportPath: reportRel,
        kpiReason: `report exit_code=${String(report.exit_code)}`,
      },
    };
  }

  return warnings.length > 0 ? { kind: "ok", warnings } : null;
}
