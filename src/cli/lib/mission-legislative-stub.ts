import type { ParsedMission, TraceRow } from "./types.js";
import { isPassStatus, isPendingStatus } from "./trace-status.js";

/** Default trace quote emitted by `gapman legislate` before worker execution. */
export const LEGISLATE_TRACE_PLACEHOLDER =
  "REPLACE_WITH_VERBATIM_QUOTE_FROM_WORKER_LOG_AFTER_EXECUTION" as const;

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
