/**
 * TypeScript compiler adapter (ADR-0041): parses plain `tsc` diagnostics
 *   path(line,col): error TS2322: message
 * into envelope v3 findings. Line-oriented and noise tolerant: paths may
 * contain parentheses (the `(line,col): error TSnnnn:` tail is the anchor),
 * indented lines extend the active diagnostic, anything else is skipped.
 * Selected only via `gate_adapter: tsc`.
 */
import type { VerifyFinding } from "../verify-finding.js";
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

export const TSC_ADAPTER_ID = "tsc";

/** `path(line,col): error TS1234: message` — greedy path, right-anchored tail. */
const PAREN_DIAGNOSTIC = /^(.*)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/;
/** `path:line:col - error TS1234: message` (pretty output with colors stripped). */
const COLON_DIAGNOSTIC = /^(.*?):(\d+):(\d+) - (error|warning) (TS\d+): (.*)$/;
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPES = /\u001b\[[0-9;]*m/g;

function matchDiagnosticLine(line: string): ParsedDiagnostic | null {
  const m = PAREN_DIAGNOSTIC.exec(line) ?? COLON_DIAGNOSTIC.exec(line);
  if (m === null) return null;
  const [, file, lineNo, col, level, code, message] = m;
  if (file === undefined || file.trim().length === 0) return null;
  return {
    file: file.trim(),
    line: Number.parseInt(lineNo ?? "0", 10),
    column: Number.parseInt(col ?? "0", 10),
    severity: level === "warning" ? "warning" : "error",
    ruleId: code ?? "TS0000",
    message: (message ?? "").trim(),
  };
}

/** Pure parser for tsc stdout; never throws on noise. */
export function parseTscOutput(stdout: string): ParsedDiagnostic[] {
  const diagnostics: ParsedDiagnostic[] = [];
  let active: ParsedDiagnostic | null = null;
  for (const raw of stdout.replace(ANSI_ESCAPES, "").split(/\r?\n/)) {
    const diagnostic = matchDiagnosticLine(raw);
    if (diagnostic !== null) {
      diagnostics.push(diagnostic);
      active = diagnostic;
      continue;
    }
    if (active !== null && /^\s+\S/.test(raw)) {
      active.message = `${active.message} ${raw.trim()}`;
      continue;
    }
    active = null;
  }
  return diagnostics;
}

export function tscFindingsFromRun(
  ctx: GateExecContext,
  run: { exitCode: number | null; successSubstringMatched: boolean; stdout: string; stdoutTruncated: boolean },
): VerifyFinding[] {
  if (run.exitCode === 0 && run.successSubstringMatched) return [];

  const diagnostics = parseTscOutput(run.stdout);
  const findings =
    diagnostics.length > 0
      ? diagnosticsToFindings(ctx, TSC_ADAPTER_ID, diagnostics)
      : run.stdoutTruncated
        ? []
        : [genericGateFailureFinding(run.exitCode, run.successSubstringMatched)];
  if (run.stdoutTruncated) findings.push(stdoutTruncatedFinding(TSC_ADAPTER_ID));
  return findings;
}

export class TscAdapter implements GateExecAdapter {
  readonly adapter_id = TSC_ADAPTER_ID;

  async execute(command: string, ctx: GateExecContext): Promise<GateExecutionResult> {
    const run = await spawnGateStreaming(command, ctx, { captureStdout: true });
    return {
      exitCode: run.exitCode,
      adapter_id: this.adapter_id,
      findings: tscFindingsFromRun(ctx, run),
    };
  }
}

export const defaultTscAdapter = new TscAdapter();
