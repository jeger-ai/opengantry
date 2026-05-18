import path from "node:path";
import { WORKER_LOG_FILENAME } from "./constants.js";
import type { TraceRow } from "./types.js";
import {
  buildWorkerLogLineMapForQuotes,
  isLineDriftFailure,
  quoteLineNumbers,
  type WorkerLogLineMap,
} from "./worker-log-line-map.js";

export interface TraceVerifyFailure {
  row: TraceRow;
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

export interface TraceVerifyResult {
  failures: TraceVerifyFailure[];
  warnings: TraceVerifyWarning[];
}

function isPassStatus(status: string): boolean {
  return status.toUpperCase().includes("PASS");
}

function verifyNumericAnchorExact(
  map: WorkerLogLineMap,
  row: TraceRow,
  lineNumber: number,
): TraceVerifyFailure | null {
  const line = map.lines[lineNumber - 1];
  if (line === undefined) {
    return {
      row,
      reason: `Anchor line ${lineNumber} out of range (file has ${map.lines.length} lines)`,
    };
  }
  if (!line.includes(row.traceQuote)) {
    return { row, reason: `Trace quote not on anchored line ${lineNumber}` };
  }
  return null;
}

function resolveDriftFromMap(
  map: WorkerLogLineMap,
  row: TraceRow,
  lineNumber: number,
): { failure: TraceVerifyFailure | null; warning: TraceVerifyWarning | null } {
  const matches = quoteLineNumbers(map, row.traceQuote);
  if (matches.length === 0) {
    return {
      failure: { row, reason: "Trace quote not found verbatim in WORKER_LOG.md" },
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
      reason: `Ambiguous trace quote: found on lines ${matches.join(", ")}; re-run a clean flight`,
    },
    warning: null,
  };
}

function verifyNumericAnchorFuzzy(
  map: WorkerLogLineMap,
  row: TraceRow,
  lineNumber: number,
): { failure: TraceVerifyFailure | null; warning: TraceVerifyWarning | null } {
  const exact = verifyNumericAnchorExact(map, row, lineNumber);
  if (exact === null) return { failure: null, warning: null };
  return resolveDriftFromMap(map, row, lineNumber);
}

function verifyFreeformAnchor(map: WorkerLogLineMap, row: TraceRow, anchor: string): TraceVerifyFailure | null {
  const found = map.lines.some((line) => line.includes(anchor) && line.includes(row.traceQuote));
  if (!found) {
    return {
      row,
      reason: `No line contains both anchor "${anchor}" and trace quote`,
    };
  }
  return null;
}

/** Line numbers are 1-based in mission table; other anchors match a substring on a line */
export function verifyTraceRows(
  workerLogPath: string,
  rows: TraceRow[],
  options: TraceVerifyOptions = {},
): TraceVerifyResult {
  const forceFuzzy = options.fuzzyNumericAnchor === true;
  const autoFuzzy = options.strictTrace !== true;
  const passRows = rows.filter((r) => isPassStatus(r.status));

  const quotes = passRows.map((r) => r.traceQuote);
  const map = buildWorkerLogLineMapForQuotes(workerLogPath, quotes);

  if (!map) {
    return {
      failures: passRows.map((row) => ({
        row,
        reason: `WORKER_LOG missing: ${workerLogPath}`,
      })),
      warnings: [],
    };
  }

  const failures: TraceVerifyFailure[] = [];
  const warnings: TraceVerifyWarning[] = [];

  for (const row of passRows) {
    if (!row.traceQuote.trim()) {
      failures.push({ row, reason: "PASS row has empty trace quote" });
      continue;
    }
    if (!map.content.includes(row.traceQuote)) {
      failures.push({ row, reason: "Trace quote not found verbatim in WORKER_LOG.md" });
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

      if (autoFuzzy && isLineDriftFailure(exactFailure.reason)) {
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

  return { failures, warnings };
}

export function defaultWorkerLogPath(repoRoot: string): string {
  return path.join(repoRoot, WORKER_LOG_FILENAME);
}
