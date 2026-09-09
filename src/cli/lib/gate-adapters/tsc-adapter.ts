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
  findingsFromRun,
  type GateRunSnapshot,
  type ParsedDiagnostic,
} from "./adapter-findings.js";
import type { GateExecContext } from "./gate-adapter-types.js";
import { parsingAdapter } from "./parsing-adapter.js";

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

export function tscFindingsFromRun(ctx: GateExecContext, run: GateRunSnapshot): VerifyFinding[] {
  return findingsFromRun("tsc", ctx, run, (stdout) => ({ ok: true, diagnostics: parseTscOutput(stdout) }));
}

export const tscAdapter = parsingAdapter("tsc", (stdout) => ({
  ok: true,
  diagnostics: parseTscOutput(stdout),
}));
