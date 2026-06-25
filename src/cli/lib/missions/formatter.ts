import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_ACTIVE_MISSION,
  LEGISLATE_TRACE_PLACEHOLDER,
  REL_MISSION_TEMPLATE,
} from "../constants.js";
import { isPassStatus, isPendingStatus, normalizeTraceStatus } from "../trace.js";
import type { ParsedMission, TraceRow } from "../types.js";

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
    kpiGate: null,
    virtualCapture: false,
    llmVerifiers: [],
    aggregators: [],
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

    rows.push({ dodId, traceQuote, anchor, status: normalizeTraceStatus(status) });
  }
  return rows;
}

export interface EmitMissionOptions {
  skillKey: string;
  msnId: string;
  outPath?: string;
}

const SKILL_LINE_TEMPLATE_PATTERN =
  /- \*\*Skill key:\*\* \[e\.g\. `[^`]+` \| `[^`]+`\]/;

export function emitActiveMissionFromTemplate(
  repoRoot: string,
  options: EmitMissionOptions,
): string {
  const templatePath = path.join(repoRoot, REL_MISSION_TEMPLATE);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`gantry: missing mission template ${REL_MISSION_TEMPLATE}`);
  }

  let body = fs.readFileSync(templatePath, "utf8");
  body = body.replace(/\[MSN-XXXX\]/g, options.msnId);
  body = body.replace(SKILL_LINE_TEMPLATE_PATTERN, `- **Skill key:** \`${options.skillKey}\``);

  const outputPath = resolveMissionOutputPath(repoRoot, options.outPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, body, "utf8");
  return outputPath;
}

function resolveMissionOutputPath(repoRoot: string, outPath: string | undefined): string {
  if (!outPath) return path.join(repoRoot, DEFAULT_ACTIVE_MISSION);
  return path.isAbsolute(outPath) ? outPath : path.join(repoRoot, outPath);
}

function isPassRow(row: TraceRow): boolean {
  return isPassStatus(row.status);
}

function isPendingRow(row: TraceRow): boolean {
  return isPendingStatus(row.status);
}

function isPlaceholderQuote(quote: string): boolean {
  return quote.trim() === LEGISLATE_TRACE_PLACEHOLDER;
}

/**
 * True when the mission file represents Teacher legislation only — no worker
 * execution evidence claimed yet. Pre-push may pass after git-proof alone.
 */
export function isLegislativeStub(mission: ParsedMission): boolean {
  if (mission.traceRows.length === 0) return true;

  const passRows = mission.traceRows.filter(isPassRow);
  if (passRows.some((row) => !isPlaceholderQuote(row.traceQuote))) {
    return false;
  }

  const pendingRows = mission.traceRows.filter(isPendingRow);
  if (
    pendingRows.length > 0 &&
    pendingRows.every((row) => isPlaceholderQuote(row.traceQuote))
  ) {
    return true;
  }

  if (passRows.length > 0 && passRows.every((row) => isPlaceholderQuote(row.traceQuote))) {
    return true;
  }

  if (passRows.length === 0 && pendingRows.length === 0) {
    return true;
  }

  return false;
}
