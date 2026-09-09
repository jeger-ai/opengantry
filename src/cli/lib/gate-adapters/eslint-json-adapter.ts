/**
 * ESLint adapter (ADR-0041): gate_command MUST run `eslint --format json`.
 * Maps `results[].messages[]` to envelope v3 findings. Selected only via the
 * mission `gate_adapter: eslint` field, never inferred from the command text.
 */
import type { VerifyFinding } from "../verify-finding.js";
import {
  findingsFromRun,
  type AdapterParseResult,
  type GateRunSnapshot,
  type ParsedDiagnostic,
} from "./adapter-findings.js";
import type { GateExecContext } from "./gate-adapter-types.js";
import { parsingAdapter } from "./parsing-adapter.js";

interface EslintMessage {
  ruleId?: string | null;
  severity?: number;
  message?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  fatal?: boolean;
}

interface EslintResult {
  filePath?: string;
  messages?: EslintMessage[];
}

export type EslintParseResult = AdapterParseResult;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function tryParseJsonArray(text: string): unknown[] | null {
  const trimmed = text.trim();
  const attempts = [trimmed];
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start > 0 && end > start) attempts.push(trimmed.slice(start, end + 1));
  for (const candidate of attempts) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function messageToDiagnostic(filePath: string, m: EslintMessage): ParsedDiagnostic {
  const fatal = m.fatal === true;
  const ruleId = typeof m.ruleId === "string" && m.ruleId.length > 0 ? m.ruleId : fatal ? "eslint/parse" : "eslint";
  return {
    file: filePath,
    line: typeof m.line === "number" && m.line > 0 ? m.line : 0,
    column: typeof m.column === "number" && m.column > 0 ? m.column : 0,
    ...(typeof m.endLine === "number" ? { endLine: m.endLine } : {}),
    ...(typeof m.endColumn === "number" ? { endColumn: m.endColumn } : {}),
    severity: m.severity === 2 || fatal ? "error" : "warning",
    ruleId,
    message: typeof m.message === "string" && m.message.length > 0 ? m.message : `${ruleId} violation`,
  };
}

/** Pure parser for `eslint --format json` stdout. */
export function parseEslintJsonOutput(stdout: string): EslintParseResult {
  const results = tryParseJsonArray(stdout);
  if (results === null) {
    return { ok: false, reason: "stdout is not an ESLint JSON results array" };
  }
  const diagnostics: ParsedDiagnostic[] = [];
  for (const entry of results) {
    if (!isRecord(entry)) continue;
    const result = entry as EslintResult;
    const filePath = typeof result.filePath === "string" ? result.filePath : "";
    for (const m of result.messages ?? []) {
      if (!isRecord(m)) continue;
      diagnostics.push(messageToDiagnostic(filePath, m as EslintMessage));
    }
  }
  return { ok: true, diagnostics };
}

export function eslintFindingsFromRun(ctx: GateExecContext, run: GateRunSnapshot): VerifyFinding[] {
  return findingsFromRun("eslint", ctx, run, parseEslintJsonOutput);
}

export const eslintJsonAdapter = parsingAdapter("eslint", parseEslintJsonOutput);
