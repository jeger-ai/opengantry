/**
 * ESLint adapter (ADR-0041): gate_command MUST run `eslint --format json`.
 * Maps `results[].messages[]` to envelope v3 findings. Selected only via the
 * mission `gate_adapter: eslint` field, never inferred from the command text.
 */
import { verifyFinding, type VerifyFinding } from "../verify-finding.js";
import {
  diagnosticsToFindings,
  genericGateFailureFinding,
  stdoutTruncatedFinding,
  type ParsedDiagnostic,
} from "./adapter-findings.js";
import type {
  GateExecAdapter,
  GateExecContext,
  GateExecutionResult,
} from "./gate-adapter-types.js";
import { spawnGateStreaming } from "./spawn-stream-core.js";

export const ESLINT_ADAPTER_ID = "eslint";

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

export type EslintParseResult =
  | { ok: true; diagnostics: ParsedDiagnostic[] }
  | { ok: false; reason: string };

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

function unparseableFinding(reason: string): VerifyFinding {
  return verifyFinding(
    "gate",
    `eslint adapter: ${reason}; gate_command must run eslint with --format json`,
    { rule_id: "eslint/unparseable-output" },
  );
}

export function eslintFindingsFromRun(
  ctx: GateExecContext,
  run: { exitCode: number | null; successSubstringMatched: boolean; stdout: string; stdoutTruncated: boolean },
): VerifyFinding[] {
  if (run.exitCode === 0 && run.successSubstringMatched) return [];
  if (run.stdoutTruncated) return [stdoutTruncatedFinding(ESLINT_ADAPTER_ID)];

  const parsed = parseEslintJsonOutput(run.stdout);
  if (!parsed.ok) return [unparseableFinding(parsed.reason)];
  if (parsed.diagnostics.length === 0) {
    return [genericGateFailureFinding(run.exitCode, run.successSubstringMatched)];
  }
  return diagnosticsToFindings(ctx, ESLINT_ADAPTER_ID, parsed.diagnostics);
}

export class EslintJsonAdapter implements GateExecAdapter {
  readonly adapter_id = ESLINT_ADAPTER_ID;

  async execute(command: string, ctx: GateExecContext): Promise<GateExecutionResult> {
    const run = await spawnGateStreaming(command, ctx, { captureStdout: true });
    return {
      exitCode: run.exitCode,
      adapter_id: this.adapter_id,
      findings: eslintFindingsFromRun(ctx, run),
    };
  }
}

export const defaultEslintJsonAdapter = new EslintJsonAdapter();
