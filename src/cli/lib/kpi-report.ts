import fs from "node:fs";
import path from "node:path";
import type { ErrorObject, ValidateFunction } from "ajv";
import Ajv2020Import from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import YAML from "yaml";
import { REL_KPI_REPORT_SCHEMA } from "./constants.js";
import type { KpiReport, KpiThreshold, KpiThresholdOp } from "./types.js";

type AjvCtor = new (opts?: object) => { compile: (schema: object) => ValidateFunction };
const Ajv2020 = Ajv2020Import as unknown as AjvCtor;
const addFormats = addFormatsImport as unknown as (ajv: InstanceType<AjvCtor>) => void;

let compiledValidator: ValidateFunction | null = null;
let compiledForRoot: string | null = null;

function loadKpiReportSchemaValidator(root: string): ValidateFunction {
  if (compiledValidator && compiledForRoot === root) {
    return compiledValidator;
  }
  const schemaPath = path.join(root, REL_KPI_REPORT_SCHEMA);
  const schemaDoc = YAML.parse(fs.readFileSync(schemaPath, "utf8")) as Record<string, unknown>;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schemaDoc);
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
  throw new Error(`gapman kpi: ${filePath}: schema validation failed: ${detail}`);
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
  if (!Number.isFinite(value)) return null;
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
