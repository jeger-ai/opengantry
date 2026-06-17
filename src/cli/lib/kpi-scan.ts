import fs from "node:fs";
import path from "node:path";
import { DEFAULT_KPI_REPORT_DIR } from "./constants.js";
import { runGate } from "./gate.js";
import { assertKpiReportSchemaValid } from "./kpi-engine.js";
import { resolveGateWorkDir } from "./gate-work-dir.js";
import type {
  KpiAggregator,
  KpiFinding,
  KpiReport,
  LlmVerifierSpec,
  ParsedMission,
} from "./types.js";

export interface KpiScanFragment {
  exit_code?: number;
  metrics?: Record<string, number | boolean>;
  findings?: KpiFinding[];
}

export interface KpiScanResult {
  reportPath: string;
  report: KpiReport;
}

function namespaceMetrics(
  verifierId: string,
  metrics: Record<string, number | boolean>,
): Record<string, number | boolean> {
  const namespaced: Record<string, number | boolean> = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (key.includes("::")) {
      namespaced[key] = value;
    } else {
      namespaced[`${verifierId}::${key}`] = value;
    }
  }
  return namespaced;
}

function parseVerifierStdout(stdout: string): KpiScanFragment {
  const trimmed = stdout.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as KpiScanFragment;
  } catch {
    return {};
  }
}

/** Verifier stdout contract: exit 0 and at least one metrics key. */
export function verifierOutputSucceeded(exitCode: number, fragment: KpiScanFragment): boolean {
  return exitCode === 0 && Object.keys(fragment.metrics ?? {}).length > 0;
}

function applyAggregators(
  metrics: Record<string, number | boolean>,
  aggregators: readonly KpiAggregator[],
): Record<string, number | boolean> {
  const out = { ...metrics };
  for (const agg of aggregators) {
    const values: number[] = [];
    for (const source of agg.sources) {
      const v = out[source];
      if (typeof v === "number" && Number.isFinite(v)) {
        values.push(v);
      } else if (typeof v === "boolean") {
        values.push(v ? 1 : 0);
      }
    }
    if (values.length === 0) continue;
    switch (agg.op) {
      case "max":
        out[agg.key] = Math.max(...values);
        break;
      case "min":
        out[agg.key] = Math.min(...values);
        break;
      case "sum":
        out[agg.key] = values.reduce((a, b) => a + b, 0);
        break;
      default: {
        const _exhaustive: never = agg.op;
        void _exhaustive;
      }
    }
  }
  return out;
}

export interface RunKpiScanOptions {
  cwd?: string;
}

/** Run llm_verifiers, merge namespaced metrics, write KPI report JSON. */
export function runKpiScan(
  root: string,
  mission: ParsedMission,
  options: RunKpiScanOptions = {},
): KpiScanResult {
  const msnId = mission.msnId;
  if (!msnId) {
    throw new Error("gapman scan: mission missing msn_id");
  }

  const verifiers = mission.llmVerifiers;
  if (verifiers.length === 0) {
    throw new Error("gapman scan: mission has no llm_verifiers configured");
  }

  const reportPath =
    mission.kpiGate?.reportPath.replace(/\\/g, "/") ??
    `${DEFAULT_KPI_REPORT_DIR}/${msnId}.json`;

  const workDir = resolveGateWorkDir(root, options);
  const mergedMetrics: Record<string, number | boolean> = {};
  const mergedFindings: KpiFinding[] = [];
  let scanExitCode = 0;

  for (const verifier of verifiers) {
    const outcome = runSingleVerifier(workDir, verifier);
    if (outcome.failed && verifier.required) {
      throw new Error(
        `gapman scan: required verifier "${verifier.id}" failed (exit ${String(outcome.exitCode)})`,
      );
    }
    if (outcome.failed) {
      mergedMetrics[`${verifier.id}::__verifier_ok`] = false;
      if (outcome.exitCode !== 0) scanExitCode = outcome.exitCode;
      continue;
    }
    mergedMetrics[`${verifier.id}::__verifier_ok`] = true;
    Object.assign(mergedMetrics, namespaceMetrics(verifier.id, outcome.fragment.metrics ?? {}));
    if (outcome.fragment.findings) {
      mergedFindings.push(...outcome.fragment.findings);
    }
    if (outcome.fragment.exit_code !== undefined && outcome.fragment.exit_code !== 0) {
      scanExitCode = outcome.fragment.exit_code;
    }
  }

  const finalMetrics = applyAggregators(mergedMetrics, mission.aggregators);
  const report: KpiReport = {
    msn_id: msnId,
    generated_at: new Date().toISOString(),
    exit_code: scanExitCode,
    metrics: finalMetrics,
    ...(mergedFindings.length > 0 ? { findings: mergedFindings } : {}),
  };

  assertKpiReportSchemaValid(root, report, reportPath);

  const absReport = path.isAbsolute(reportPath)
    ? reportPath
    : path.join(root, reportPath.replace(/\\/g, path.sep));
  fs.mkdirSync(path.dirname(absReport), { recursive: true });
  fs.writeFileSync(absReport, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return { reportPath, report };
}

function runSingleVerifier(
  workDir: string,
  verifier: LlmVerifierSpec,
): { failed: boolean; exitCode: number; fragment: KpiScanFragment } {
  const result = runGate(workDir, { command: verifier.command, successSubstring: null });
  const exitCode = result.exitCode ?? 1;
  const fragment = parseVerifierStdout(result.stdout);
  const failed = !verifierOutputSucceeded(exitCode, fragment);
  return { failed, exitCode, fragment };
}
