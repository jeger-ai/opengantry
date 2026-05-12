import fs from "node:fs";
import path from "node:path";
import { WORKER_LOG_FILENAME } from "./constants.js";
import type { TraceRow } from "./types.js";

export interface TraceVerifyFailure {
  row: TraceRow;
  reason: string;
}

function isPassStatus(status: string): boolean {
  return status.toUpperCase().includes("PASS");
}

function verifyNumericAnchor(
  lines: string[],
  row: TraceRow,
  lineNumber: number,
): TraceVerifyFailure | null {
  const line = lines[lineNumber - 1];
  if (line === undefined) {
    return {
      row,
      reason: `Anchor line ${lineNumber} out of range (file has ${lines.length} lines)`,
    };
  }
  if (!line.includes(row.traceQuote)) {
    return { row, reason: `Trace quote not on anchored line ${lineNumber}` };
  }
  return null;
}

function verifyFreeformAnchor(lines: string[], row: TraceRow, anchor: string): TraceVerifyFailure | null {
  const found = lines.some((line) => line.includes(anchor) && line.includes(row.traceQuote));
  if (!found) {
    return {
      row,
      reason: `No line contains both anchor "${anchor}" and trace quote`,
    };
  }
  return null;
}

/** Line numbers are 1-based in mission table; other anchors match a substring on a line */
export function verifyTraceRows(workerLogPath: string, rows: TraceRow[]): TraceVerifyFailure[] {
  const passRows = rows.filter((r) => isPassStatus(r.status));
  if (!fs.existsSync(workerLogPath)) {
    return passRows.map((row) => ({
      row,
      reason: `WORKER_LOG missing: ${workerLogPath}`,
    }));
  }

  const content = fs.readFileSync(workerLogPath, "utf8");
  const lines = content.split(/\r?\n/);
  const failures: TraceVerifyFailure[] = [];

  for (const row of passRows) {
    if (!row.traceQuote.trim()) {
      failures.push({ row, reason: "PASS row has empty trace quote" });
      continue;
    }
    if (!content.includes(row.traceQuote)) {
      failures.push({ row, reason: "Trace quote not found verbatim in WORKER_LOG.md" });
      continue;
    }

    const anchor = row.anchor.trim();
    let failure: TraceVerifyFailure | null = null;
    if (/^\d+$/.test(anchor)) {
      failure = verifyNumericAnchor(lines, row, parseInt(anchor, 10));
    } else {
      failure = verifyFreeformAnchor(lines, row, anchor);
    }
    if (failure) failures.push(failure);
  }

  return failures;
}

export function defaultWorkerLogPath(repoRoot: string): string {
  return path.join(repoRoot, WORKER_LOG_FILENAME);
}
