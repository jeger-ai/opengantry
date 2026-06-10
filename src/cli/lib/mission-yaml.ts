import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { REL_MISSION_SCHEMA, MSN_ID_PATTERN } from "./constants.js";
import { LEGISLATE_TRACE_PLACEHOLDER } from "./mission-legislative-stub.js";
import { normalizeTraceStatus } from "./trace-status.js";
import type { ParsedMission, TraceRow, YamlMission } from "./types.js";

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

function parsedMissionFromYaml(absPath: string, data: YamlMission): ParsedMission {
  const traceRows: TraceRow[] = (data.trace_rows ?? []).map((r) => ({
    dodId: r.dod_id,
    traceQuote: r.trace_quote,
    anchor: r.anchor,
    status: normalizeTraceStatus(r.status),
  }));
  return {
    msnId: (data.msn_id ?? data.msnId)!,
    skillKey: data.skill_key,
    gate: {
      command: data.gate_command,
      successSubstring: data.gate_success_substring ?? null,
    },
    traceRows,
    rawPath: absPath,
  };
}

export function validateYamlMission(root: string, filePath: string, body: string): ParsedMission {
  ensureMissionSchemaFileExists(root);
  const data = YAML.parse(body) as unknown;
  assertYamlMissionShape(data, filePath);
  return parsedMissionFromYaml(filePath, data);
}
