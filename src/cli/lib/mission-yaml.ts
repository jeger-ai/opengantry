import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { REL_MISSION_SCHEMA, DEFAULT_KPI_REPORT_DIR } from "./constants.js";
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
  return parsedMissionFromYaml(filePath, data as YamlMission);
}
