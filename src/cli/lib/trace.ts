import fs from "node:fs";
import path from "node:path";
import type { TraceRow } from "./types.js";

export interface TraceVerifyFailure {
  row: TraceRow;
  reason: string;
}

/** Line numbers are 1-based in mission table; timestamps match substring in log line */
export function verifyTraceRows(workerLogPath: string, rows: TraceRow[]): TraceVerifyFailure[] {
  if (!fs.existsSync(workerLogPath)) {
    return rows
      .filter((r) => r.status.toUpperCase().includes("PASS"))
      .map((r) => ({ row: r, reason: `WORKER_LOG missing: ${workerLogPath}` }));
  }
  const content = fs.readFileSync(workerLogPath, "utf8");
  const lines = content.split(/\r?\n/);
  const failures: TraceVerifyFailure[] = [];

  for (const row of rows) {
    if (!row.status.toUpperCase().includes("PASS")) continue;
    if (!row.traceQuote.trim()) {
      failures.push({ row, reason: "PASS row has empty trace quote" });
      continue;
    }
    if (!content.includes(row.traceQuote)) {
      failures.push({ row, reason: "Trace quote not found verbatim in WORKER_LOG.md" });
      continue;
    }
    const anchor = row.anchor.trim();
    if (/^\d+$/.test(anchor)) {
      const n = parseInt(anchor, 10);
      const line = lines[n - 1];
      if (line === undefined) {
        failures.push({ row, reason: `Anchor line ${n} out of range (file has ${lines.length} lines)` });
        continue;
      }
      if (!line.includes(row.traceQuote)) {
        failures.push({ row, reason: `Trace quote not on anchored line ${n}` });
      }
    } else {
      const idx = lines.findIndex((ln) => ln.includes(anchor) && ln.includes(row.traceQuote));
      if (idx < 0) {
        failures.push({
          row,
          reason: `No line contains both anchor "${anchor}" and trace quote`,
        });
      }
    }
  }
  return failures;
}

export function defaultWorkerLogPath(root: string): string {
  return path.join(root, "WORKER_LOG.md");
}
