import { evaluateKpiThresholds, loadKpiReport } from "./kpi-report.js";
import { verifyKpiReportFreshness } from "./kpi-report-stale.js";
import type { KpiGateSpec, KpiReport, Manifest } from "./types.js";
import type { VerifyOptions } from "./verify-types.js";
import type { VerifyPhaseFailure } from "./verify-engine.js";

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

export function evaluateKpiPhase(
  root: string,
  manifest: Manifest,
  skillKey: string | null,
  kpiGate: KpiGateSpec,
  options: VerifyOptions,
  workerLogPath: string,
): VerifyPhaseFailure | { warnings: string[] } | null {
  const reportRel = kpiGate.reportPath.replace(/\\/g, "/");
  const loaded = loadReportOrFail(root, reportRel, workerLogPath);
  if ("ok" in loaded) return loaded;

  const stale = verifyKpiReportFreshness(root, manifest, skillKey, reportRel, {
    skipStaleEvidence: options.skipStaleEvidence === true,
    strictStale: options.prePush === true || options.ci === true,
  });

  const warnings: string[] = [];
  if (stale.advisoryOnly && stale.reason) {
    warnings.push(`gapman verify: advisory — ${stale.reason}`);
  }
  if (stale.stale) return staleFailure(reportRel, workerLogPath, stale);

  const report = loaded.report;
  const failures = evaluateKpiThresholds(report, kpiGate.thresholds);
  if (failures.length > 0) return thresholdFailure(reportRel, workerLogPath, failures[0]!);

  if (report.exit_code !== 0) {
    return {
      ok: false,
      phase: "kpi",
      message: `KPI report exit_code=${String(report.exit_code)} (expected 0)`,
      exitCode: 1,
      workerLogPath,
      kpiReportPath: reportRel,
      kpiReason: `report exit_code=${String(report.exit_code)}`,
    };
  }

  return warnings.length > 0 ? { warnings } : null;
}
