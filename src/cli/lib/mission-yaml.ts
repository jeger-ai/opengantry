import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { REL_MISSION_SCHEMA, MSN_ID_PATTERN, DEFAULT_KPI_REPORT_DIR } from "./constants.js";
import { assertMissionSchemaValid } from "./mission-schema-validate.js";
import { LEGISLATE_TRACE_PLACEHOLDER } from "./mission-legislative-stub.js";
import { normalizeTraceStatus } from "./trace-status.js";
import type {
  KpiAggregator,
  KpiAggregatorOp,
  KpiGateSpec,
  KpiThreshold,
  KpiThresholdOp,
  LlmVerifierSpec,
  ParsedMission,
  TraceRow,
  YamlMission,
} from "./types.js";

export interface MissionTraceRowStub {
  dod_id: string;
  trace_quote: string;
  anchor: string;
  status: string;
}

export interface MissionYamlEmitOptions {
  header: string;
  doc: Record<string, unknown>;
}

/** Shared mission YAML emitter for legislate and upgrade scaffolds. */
export function buildMissionYamlScaffold(opts: MissionYamlEmitOptions): string {
  return `${opts.header}${YAML.stringify(opts.doc)}`;
}

/** Shared legislative trace stub row for mission YAML scaffolds. */
export function buildLegislativeTraceRows(): MissionTraceRowStub[] {
  return [
    {
      dod_id: "1",
      trace_quote: LEGISLATE_TRACE_PLACEHOLDER,
      anchor: "1",
      status: "PENDING",
    },
  ];
}

export function ensureMissionSchemaFileExists(root: string): void {
  const schemaPath = path.join(root, REL_MISSION_SCHEMA);
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`gapman: missing MISSION schema at ${REL_MISSION_SCHEMA}`);
  }
  YAML.parse(fs.readFileSync(schemaPath, "utf8"));
}

function assertOptionalMissionExtensions(o: Record<string, unknown>, filePath: string): void {
  if (o.kpi_gate !== undefined) assertYamlKpiGate(o.kpi_gate, filePath);
  if (o.llm_verifiers !== undefined) {
    if (!Array.isArray(o.llm_verifiers)) {
      throw new Error(`gapman mission: ${filePath}: llm_verifiers must be an array`);
    }
    for (const v of o.llm_verifiers) assertYamlLlmVerifier(v, filePath);
  }
  if (o.aggregators !== undefined) {
    if (!Array.isArray(o.aggregators)) {
      throw new Error(`gapman mission: ${filePath}: aggregators must be an array`);
    }
    for (const a of o.aggregators) assertYamlAggregator(a, filePath);
  }
}

function assertYamlMissionShape(data: unknown, filePath: string): asserts data is YamlMission {
  if (typeof data !== "object" || data === null) {
    throw new Error(`gapman mission: ${filePath}: root must be an object`);
  }
  const o = data as Record<string, unknown>;
  const msnRaw =
    typeof o.msn_id === "string" && MSN_ID_PATTERN.test(o.msn_id)
      ? o.msn_id
      : typeof o.msnId === "string" && MSN_ID_PATTERN.test(o.msnId)
        ? o.msnId
        : null;
  if (!msnRaw) {
    throw new Error(`gapman mission: ${filePath}: msn_id or msnId must match MSN-NNNN`);
  }
  if (typeof o.skill_key !== "string" || o.skill_key.length === 0) {
    throw new Error(`gapman mission: ${filePath}: skill_key required`);
  }
  if (typeof o.gate_command !== "string" || o.gate_command.length === 0) {
    throw new Error(`gapman mission: ${filePath}: gate_command required`);
  }
  if (
    o.gate_success_substring !== undefined &&
    o.gate_success_substring !== null &&
    typeof o.gate_success_substring !== "string"
  ) {
    throw new Error(`gapman mission: ${filePath}: gate_success_substring must be string or null`);
  }
  if (o.trace_rows !== undefined) {
    if (!Array.isArray(o.trace_rows)) {
      throw new Error(`gapman mission: ${filePath}: trace_rows must be an array`);
    }
    for (const row of o.trace_rows) {
      assertYamlTraceRow(row, filePath);
    }
  }
  assertOptionalMissionExtensions(o, filePath);
}

function assertYamlTraceRow(row: unknown, filePath: string): void {
  if (typeof row !== "object" || row === null) {
    throw new Error(`gapman mission: ${filePath}: trace_rows item must be object`);
  }
  const r = row as Record<string, unknown>;
  const keys = ["dod_id", "trace_quote", "anchor", "status"] as const;
  for (const k of keys) {
    if (typeof r[k] !== "string") {
      throw new Error(`gapman mission: ${filePath}: trace_rows.${k} must be string`);
    }
  }
  if (!/^(PASS|FAIL|PENDING|pass|fail|pending)$/.test(String(r.status))) {
    throw new Error(`gapman mission: ${filePath}: trace_rows.status must be PASS, FAIL, or PENDING`);
  }
}

const KPI_THRESHOLD_OPS = new Set<KpiThresholdOp>(["<=", ">=", "==", "<", ">"]);
const KPI_AGGREGATOR_OPS = new Set<KpiAggregatorOp>(["max", "min", "sum"]);

function assertYamlKpiGate(raw: unknown, filePath: string): void {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`gapman mission: ${filePath}: kpi_gate must be object`);
  }
  const g = raw as Record<string, unknown>;
  if (g.report_path !== undefined && typeof g.report_path !== "string") {
    throw new Error(`gapman mission: ${filePath}: kpi_gate.report_path must be string`);
  }
  if (!Array.isArray(g.thresholds) || g.thresholds.length === 0) {
    throw new Error(`gapman mission: ${filePath}: kpi_gate.thresholds must be a non-empty array`);
  }
  for (const t of g.thresholds) {
    assertYamlKpiThreshold(t, filePath);
  }
}

function assertYamlKpiThreshold(raw: unknown, filePath: string): void {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`gapman mission: ${filePath}: kpi_gate.thresholds item must be object`);
  }
  const t = raw as Record<string, unknown>;
  if (typeof t.metric !== "string" || t.metric.length === 0) {
    throw new Error(`gapman mission: ${filePath}: kpi_gate.thresholds.metric must be non-empty string`);
  }
  if (typeof t.op !== "string" || !KPI_THRESHOLD_OPS.has(t.op as KpiThresholdOp)) {
    throw new Error(`gapman mission: ${filePath}: kpi_gate.thresholds.op must be <=, >=, ==, <, or >`);
  }
  if (typeof t.value !== "number" || !Number.isFinite(t.value)) {
    throw new Error(`gapman mission: ${filePath}: kpi_gate.thresholds.value must be finite number`);
  }
}

function assertYamlLlmVerifier(raw: unknown, filePath: string): void {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`gapman mission: ${filePath}: llm_verifiers item must be object`);
  }
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== "string" || v.id.length === 0) {
    throw new Error(`gapman mission: ${filePath}: llm_verifiers.id must be non-empty string`);
  }
  if (typeof v.command !== "string" || v.command.length === 0) {
    throw new Error(`gapman mission: ${filePath}: llm_verifiers.command must be non-empty string`);
  }
  if (v.provider !== undefined && typeof v.provider !== "string") {
    throw new Error(`gapman mission: ${filePath}: llm_verifiers.provider must be string`);
  }
  if (v.required !== undefined && typeof v.required !== "boolean") {
    throw new Error(`gapman mission: ${filePath}: llm_verifiers.required must be boolean`);
  }
}

function assertYamlAggregator(raw: unknown, filePath: string): void {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`gapman mission: ${filePath}: aggregators item must be object`);
  }
  const a = raw as Record<string, unknown>;
  if (typeof a.key !== "string" || a.key.length === 0) {
    throw new Error(`gapman mission: ${filePath}: aggregators.key must be non-empty string`);
  }
  if (typeof a.op !== "string" || !KPI_AGGREGATOR_OPS.has(a.op as KpiAggregatorOp)) {
    throw new Error(`gapman mission: ${filePath}: aggregators.op must be max, min, or sum`);
  }
  if (!Array.isArray(a.sources) || a.sources.length === 0) {
    throw new Error(`gapman mission: ${filePath}: aggregators.sources must be non-empty array`);
  }
  for (const s of a.sources) {
    if (typeof s !== "string" || s.length === 0) {
      throw new Error(`gapman mission: ${filePath}: aggregators.sources items must be non-empty strings`);
    }
  }
}

function defaultKpiReportPath(msnId: string): string {
  return `${DEFAULT_KPI_REPORT_DIR}/${msnId}.json`;
}

function parsedKpiGateFromYaml(data: YamlMission, msnId: string): KpiGateSpec | null {
  const raw = data.kpi_gate;
  if (!raw) return null;
  const thresholds: KpiThreshold[] = raw.thresholds.map((t) => ({
    metric: t.metric,
    op: t.op as KpiThresholdOp,
    value: t.value,
  }));
  return {
    reportPath: raw.report_path?.trim() || defaultKpiReportPath(msnId),
    thresholds,
  };
}

function parsedLlmVerifiersFromYaml(data: YamlMission): LlmVerifierSpec[] {
  return (data.llm_verifiers ?? []).map((v) => ({
    id: v.id,
    command: v.command,
    provider: v.provider,
    required: v.required === true,
  }));
}

function parsedAggregatorsFromYaml(data: YamlMission): KpiAggregator[] {
  return (data.aggregators ?? []).map((a) => ({
    key: a.key,
    op: a.op as KpiAggregatorOp,
    sources: [...a.sources],
  }));
}

function parsedMissionFromYaml(absPath: string, data: YamlMission): ParsedMission {
  const traceRows: TraceRow[] = (data.trace_rows ?? []).map((r) => ({
    dodId: r.dod_id,
    traceQuote: r.trace_quote,
    anchor: r.anchor,
    status: normalizeTraceStatus(r.status),
  }));
  const msnId = (data.msn_id ?? data.msnId)!;
  return {
    msnId,
    skillKey: data.skill_key,
    gate: {
      command: data.gate_command,
      successSubstring: data.gate_success_substring ?? null,
    },
    kpiGate: parsedKpiGateFromYaml(data, msnId),
    llmVerifiers: parsedLlmVerifiersFromYaml(data),
    aggregators: parsedAggregatorsFromYaml(data),
    traceRows,
    rawPath: absPath,
  };
}

export function validateYamlMission(root: string, filePath: string, body: string): ParsedMission {
  ensureMissionSchemaFileExists(root);
  const data = YAML.parse(body) as unknown;
  assertMissionSchemaValid(root, data, filePath);
  assertYamlMissionShape(data, filePath);
  return parsedMissionFromYaml(filePath, data);
}
