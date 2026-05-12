import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { GateSpec, ParsedMission, TraceRow } from "./types.js";

/** Parse MISSION.template-style markdown */
export function parseMarkdownMission(filePath: string, body: string): ParsedMission {
  const msn = body.match(/# Mission:\s*\[?(MSN-\d{4})\]?/i);
  const skill = body.match(/\*\*Skill key:\*\*\s*\[?[^\]]*?`?([a-z0-9-]+)`?/i);
  let gateCommand: string | null = null;
  let successCriteria: string | null = null;
  const gateBlock = body.match(/\*\*Command:\*\*\s*`([^`]+)`/);
  if (gateBlock) gateCommand = gateBlock[1]!.trim();
  const sc = body.match(/\*\*Success criteria:\*\*\s*\[?([^\]\n]+)\]?/);
  if (sc) successCriteria = sc[1]!.trim();

  const traceRows = parseTraceTable(body);

  return {
    msnId: msn?.[1] ?? null,
    skillKey: skill?.[1] ?? null,
    gate:
      gateCommand !== null
        ? {
            command: gateCommand,
            successSubstring:
              successCriteria &&
              !successCriteria.toLowerCase().includes("exit code") &&
              successCriteria.length > 0
                ? successCriteria
                : null,
          }
        : null,
    traceRows,
    rawPath: filePath,
  };
}

function parseTraceTable(body: string): TraceRow[] {
  const rows: TraceRow[] = [];
  const sectionIdx = body.indexOf("## 4. Verification trace");
  const slice = sectionIdx >= 0 ? body.slice(sectionIdx) : body;
  const lines = slice.split("\n");
  let inTable = false;
  for (const line of lines) {
    if (line.includes("| DoD # |")) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (line.trim().startsWith("|") && line.includes("---")) continue;
    if (!line.trim().startsWith("|")) {
      if (rows.length > 0) break;
      continue;
    }
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (cells.length < 4) continue;
    const dodId = cells[0]!;
    if (dodId === "DoD #" || dodId.match(/^#+$/)) continue;
    const traceQuote = cells[1]!;
    const anchor = cells[2]!;
    const status = cells[3]!;
    if (!traceQuote.trim()) continue;
    if (!status.match(/PASS|FAIL/i)) continue;
    rows.push({ dodId, traceQuote, anchor, status });
  }
  return rows;
}

export interface YamlMission {
  msn_id: string;
  skill_key: string;
  gate_command: string;
  gate_success_substring?: string | null;
  trace_rows?: Array<{
    dod_id: string;
    trace_quote: string;
    anchor: string;
    status: string;
  }>;
}

export function loadMissionSchema(root: string): object {
  const p = path.join(root, ".gitagent/teacher/MISSION.schema.yaml");
  if (!fs.existsSync(p)) throw new Error(`gapman: missing MISSION schema at ${p}`);
  const doc = YAML.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
  const { $schema: _s, ...rest } = doc;
  return rest;
}

function assertYamlMissionShape(data: unknown, filePath: string): asserts data is YamlMission {
  if (typeof data !== "object" || data === null) {
    throw new Error(`gapman mission: ${filePath}: root must be an object`);
  }
  const o = data as Record<string, unknown>;
  if (typeof o.msn_id !== "string" || !/^MSN-[0-9]{4}$/.test(o.msn_id)) {
    throw new Error(`gapman mission: ${filePath}: msn_id must match MSN-NNNN`);
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
      if (typeof row !== "object" || row === null) {
        throw new Error(`gapman mission: ${filePath}: trace_rows item must be object`);
      }
      const r = row as Record<string, unknown>;
      for (const k of ["dod_id", "trace_quote", "anchor", "status"] as const) {
        if (typeof r[k] !== "string") {
          throw new Error(`gapman mission: ${filePath}: trace_rows.${k} must be string`);
        }
      }
      if (!/^(PASS|FAIL|pass|fail)$/.test(String(r.status))) {
        throw new Error(`gapman mission: ${filePath}: trace_rows.status must be PASS or FAIL`);
      }
    }
  }
}

export function validateYamlMission(root: string, filePath: string, body: string): ParsedMission {
  loadMissionSchema(root);
  const data = YAML.parse(body) as unknown;
  assertYamlMissionShape(data, filePath);
  const m = data as YamlMission;
  const traceRows: TraceRow[] = (m.trace_rows ?? []).map((r) => ({
    dodId: r.dod_id,
    traceQuote: r.trace_quote,
    anchor: r.anchor,
    status: r.status,
  }));
  const gate: GateSpec = {
    command: m.gate_command,
    successSubstring: m.gate_success_substring ?? null,
  };
  return {
    msnId: m.msn_id,
    skillKey: m.skill_key,
    gate,
    traceRows,
    rawPath: filePath,
  };
}

export function parseMissionFile(root: string, filePath: string): ParsedMission {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  const body = fs.readFileSync(abs, "utf8");
  const ext = path.extname(abs).toLowerCase();
  if (ext === ".yaml" || ext === ".yml") {
    return validateYamlMission(root, abs, body);
  }
  return parseMarkdownMission(abs, body);
}

export function assertMissionGatePresent(m: ParsedMission): void {
  if (!m.gate?.command) {
    throw new Error(`gapman mission: no deterministic gate (Command) found in ${m.rawPath}`);
  }
}
