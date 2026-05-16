import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { REL_MISSION_SCHEMA, MSN_ID_PATTERN } from "./constants.js";
import { extractMsnIdFromMissionBody } from "./mission-msn.js";
import type { GateSpec, ParsedMission, TraceRow, YamlMission } from "./types.js";

const TRACE_SECTION_MARKER = "## 4. Verification trace";

function gateFromMarkdown(successCriteria: string | null): string | null {
  if (!successCriteria?.trim()) return null;
  const lower = successCriteria.toLowerCase();
  if (lower.includes("exit code")) return null;
  return successCriteria.trim();
}

/** Parse MISSION.template-style markdown */
export function parseMarkdownMission(filePath: string, body: string): ParsedMission {
  const msnMatch = body.match(/# Mission:\s*\[?(MSN-\d{4})\]?/i);
  const skillMatch = body.match(/\*\*Skill key:\*\*\s*\[?[^\]]*?`?([a-z0-9-]+)`?/i);
  const commandMatch = body.match(/\*\*Command:\*\*\s*`([^`]+)`/);
  const criteriaMatch =
    body.match(/\*\*Success criteria:\*\*\s*\[?([^\]\n]+)\]?/) ??
    body.match(/\*\*Success:\*\*\s*\[?([^\]\n]+)\]?/i);

  const gateCommand = commandMatch?.[1]?.trim() ?? null;
  const successRaw = criteriaMatch?.[1]?.trim() ?? null;

  return {
    msnId: msnMatch?.[1] ?? null,
    skillKey: skillMatch?.[1] ?? null,
    gate:
      gateCommand !== null
        ? {
            command: gateCommand,
            successSubstring: gateFromMarkdown(successRaw),
          }
        : null,
    traceRows: parseTraceTable(body),
    rawPath: filePath,
  };
}

/** Markdown pipe-table separator: every non-empty cell is only dashes (optional colons for alignment). */
export function isMarkdownTableSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return false;
  const cells = trimmed
    .split("|")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  if (cells.length < 2) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseTraceTable(body: string): TraceRow[] {
  const rows: TraceRow[] = [];
  const sectionStart = body.indexOf(TRACE_SECTION_MARKER);
  const relevant = sectionStart >= 0 ? body.slice(sectionStart) : body;
  const lines = relevant.split("\n");
  let insideTable = false;

  for (const line of lines) {
    if (line.includes("| DoD # |")) {
      insideTable = true;
      continue;
    }
    if (!insideTable) continue;
    if (isMarkdownTableSeparatorRow(line)) continue;

    if (!line.trim().startsWith("|")) {
      if (rows.length > 0) break;
      continue;
    }

    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (cells.length < 4) continue;

    const [dodId, traceQuote, anchor, status] = cells;
    if (!dodId || !traceQuote || !anchor || !status) continue;
    if (dodId === "DoD #" || /^#+$/.test(dodId)) continue;
    if (!traceQuote.trim()) continue;
    if (!/PASS|FAIL/i.test(status)) continue;

    rows.push({ dodId, traceQuote, anchor, status });
  }
  return rows;
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
  if (!/^(PASS|FAIL|pass|fail)$/.test(String(r.status))) {
    throw new Error(`gapman mission: ${filePath}: trace_rows.status must be PASS or FAIL`);
  }
}

function parsedMissionFromYaml(absPath: string, data: YamlMission): ParsedMission {
  const traceRows: TraceRow[] = (data.trace_rows ?? []).map((r) => ({
    dodId: r.dod_id,
    traceQuote: r.trace_quote,
    anchor: r.anchor,
    status: r.status,
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

export function parseMissionFile(root: string, filePath: string): ParsedMission {
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  const body = fs.readFileSync(absolute, "utf8");
  const ext = path.extname(absolute).toLowerCase();
  const mission =
    ext === ".yaml" || ext === ".yml"
      ? validateYamlMission(root, absolute, body)
      : parseMarkdownMission(absolute, body);
  const proofMsn = extractMsnIdFromMissionBody(body, ext);
  if (proofMsn) {
    return { ...mission, msnId: proofMsn };
  }
  return mission;
}

export function assertMissionGatePresent(mission: ParsedMission): void {
  if (!mission.gate?.command?.trim()) {
    throw new Error(`gapman mission: no deterministic gate (Command) found in ${mission.rawPath}`);
  }
}
