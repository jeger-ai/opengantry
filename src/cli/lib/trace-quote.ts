import path from "node:path";
import { LEGISLATE_TRACE_PLACEHOLDER, EXECUTOR_LOG_FILENAME } from "./constants.js";
import { quoteLineNumbers, type ExecutorLogLineMap, buildExecutorLogLineMapForQuotes } from "./executor-log-line-map.js";
import type { TraceRow } from "./types.js";
import { isPassTraceRow } from "./trace-status.js";

/** Typed trace verification failure — control flow must branch on this, not UI strings. */
export type TraceFailureKind =
  | "ambiguous"
  | "quote_missing"
  | "executor_log_missing"
  | "placeholder_quote"
  | "strict_line_drift"
  | "empty_quote"
  | "anchor_mismatch"
  | "stale_evidence"
  | "other";

function missingQuoteKind(traceQuote: string): TraceFailureKind {
  return traceQuote.trim() === LEGISLATE_TRACE_PLACEHOLDER ? "placeholder_quote" : "quote_missing";
}

export interface TraceVerifyFailure {
  row: TraceRow;
  /** Set at construction — every failure site knows its own kind. */
  kind: TraceFailureKind;
  reason: string;
}

export interface TraceVerifyWarning {
  row: TraceRow;
  declaredLine: number;
  foundLine: number;
  autoResolved?: boolean;
}

export interface TraceVerifyOptions {
  /** Force fuzzy for all numeric anchors. */
  fuzzyNumericAnchor?: boolean;
  /** Disable auto-retry on line drift only. */
  strictTrace?: boolean;
}

export interface ResolvedQuoteLine {
  row: TraceRow;
  lineNumber: number;
}

export interface TraceVerifyResult {
  failures: TraceVerifyFailure[];
  warnings: TraceVerifyWarning[];
  resolvedLines: ResolvedQuoteLine[];
  map: ExecutorLogLineMap | null;
}

export function resolveQuoteLineNumber(
  map: ExecutorLogLineMap,
  row: TraceRow,
  resolvedLineByDodId: ReadonlyMap<string, number>,
): number | null {
  const override = resolvedLineByDodId.get(row.dodId);
  if (override !== undefined) return override;

  const anchor = row.anchor.trim();
  if (/^\d+$/.test(anchor)) {
    const declared = parseInt(anchor, 10);
    const line = map.lines[declared - 1];
    if (line !== undefined && line.includes(row.traceQuote)) return declared;
    const matches = quoteLineNumbers(map, row.traceQuote);
    if (matches.length === 1) return matches[0]!;
    return null;
  }

  for (let i = 0; i < map.lines.length; i++) {
    const line = map.lines[i]!;
    if (line.includes(anchor) && line.includes(row.traceQuote)) return i + 1;
  }
  return null;
}

function buildResolvedQuoteLines(
  passRows: TraceRow[],
  map: ExecutorLogLineMap,
  warnings: TraceVerifyWarning[],
): ResolvedQuoteLine[] {
  const resolvedLineByDodId = new Map<string, number>();
  for (const warning of warnings) {
    resolvedLineByDodId.set(warning.row.dodId, warning.foundLine);
  }
  const resolved: ResolvedQuoteLine[] = [];
  for (const row of passRows) {
    const lineNumber = resolveQuoteLineNumber(map, row, resolvedLineByDodId);
    if (lineNumber !== null) resolved.push({ row, lineNumber });
  }
  return resolved;
}

function verifyNumericAnchorExact(
  map: ExecutorLogLineMap,
  row: TraceRow,
  lineNumber: number,
): TraceVerifyFailure | null {
  const line = map.lines[lineNumber - 1];
  if (line === undefined) {
    return {
      row,
      kind: "strict_line_drift",
      reason: `Anchor line ${lineNumber} out of range (file has ${map.lines.length} lines)`,
    };
  }
  if (!line.includes(row.traceQuote)) {
    return { row, kind: "strict_line_drift", reason: `Trace quote not on anchored line ${lineNumber}` };
  }
  return null;
}

function resolveDriftFromMap(
  map: ExecutorLogLineMap,
  row: TraceRow,
  lineNumber: number,
): { failure: TraceVerifyFailure | null; warning: TraceVerifyWarning | null } {
  const matches = quoteLineNumbers(map, row.traceQuote);
  if (matches.length === 0) {
    return {
      failure: {
        row,
        kind: missingQuoteKind(row.traceQuote),
        reason: "Trace quote not found verbatim in EXECUTOR_LOG.md",
      },
      warning: null,
    };
  }
  if (matches.length === 1) {
    const foundLine = matches[0]!;
    return {
      failure: null,
      warning: { row, declaredLine: lineNumber, foundLine, autoResolved: true },
    };
  }
  return {
    failure: {
      row,
      kind: "ambiguous",
      reason: `Ambiguous trace quote: found on lines ${matches.join(", ")}; re-run a clean flight`,
    },
    warning: null,
  };
}

function verifyNumericAnchorFuzzy(
  map: ExecutorLogLineMap,
  row: TraceRow,
  lineNumber: number,
): { failure: TraceVerifyFailure | null; warning: TraceVerifyWarning | null } {
  const exact = verifyNumericAnchorExact(map, row, lineNumber);
  if (exact === null) return { failure: null, warning: null };
  return resolveDriftFromMap(map, row, lineNumber);
}

function verifyFreeformAnchor(map: ExecutorLogLineMap, row: TraceRow, anchor: string): TraceVerifyFailure | null {
  const found = map.lines.some((line) => line.includes(anchor) && line.includes(row.traceQuote));
  if (!found) {
    return {
      row,
      kind: "anchor_mismatch",
      reason: `No line contains both anchor "${anchor}" and trace quote`,
    };
  }
  return null;
}

/** Line numbers are 1-based in mission table; other anchors match a substring on a line */
export function verifyTraceRows(
  executorLogPath: string,
  rows: TraceRow[],
  options: TraceVerifyOptions = {},
): TraceVerifyResult {
  const forceFuzzy = options.fuzzyNumericAnchor === true;
  const autoFuzzy = options.strictTrace !== true;
  const passRows = rows.filter((r) => isPassTraceRow(r.status));

  const quotes = passRows.map((r) => r.traceQuote);
  const map = buildExecutorLogLineMapForQuotes(executorLogPath, quotes);

  if (!map) {
    return {
      failures: passRows.map((row) => ({
        row,
        kind: "executor_log_missing" as const,
        reason: `EXECUTOR_LOG missing: ${executorLogPath}`,
      })),
      warnings: [],
      resolvedLines: [],
      map: null,
    };
  }

  const failures: TraceVerifyFailure[] = [];
  const warnings: TraceVerifyWarning[] = [];

  for (const row of passRows) {
    if (!row.traceQuote.trim()) {
      failures.push({ row, kind: "empty_quote", reason: "PASS row has empty trace quote" });
      continue;
    }
    if (!map.content.includes(row.traceQuote)) {
      failures.push({
        row,
        kind: missingQuoteKind(row.traceQuote),
        reason: "Trace quote not found verbatim in EXECUTOR_LOG.md",
      });
      continue;
    }

    const anchor = row.anchor.trim();
    if (/^\d+$/.test(anchor)) {
      const lineNumber = parseInt(anchor, 10);
      if (forceFuzzy) {
        const { failure, warning } = verifyNumericAnchorFuzzy(map, row, lineNumber);
        if (failure) failures.push(failure);
        else if (warning) warnings.push(warning);
        continue;
      }

      const exactFailure = verifyNumericAnchorExact(map, row, lineNumber);
      if (exactFailure === null) continue;

      // Exact numeric-anchor failures are always line drift; auto-fuzzy retries them.
      if (autoFuzzy) {
        const { failure, warning } = resolveDriftFromMap(map, row, lineNumber);
        if (failure) failures.push(failure);
        else if (warning) warnings.push(warning);
      } else {
        failures.push(exactFailure);
      }
      continue;
    }

    const failure = verifyFreeformAnchor(map, row, anchor);
    if (failure) failures.push(failure);
  }

  return {
    failures,
    warnings,
    resolvedLines: buildResolvedQuoteLines(passRows, map, warnings),
    map,
  };
}

export function defaultExecutorLogPath(repoRoot: string): string {
  return path.join(repoRoot, EXECUTOR_LOG_FILENAME);
}
