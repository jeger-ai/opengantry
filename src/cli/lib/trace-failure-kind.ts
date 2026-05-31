import { LEGISLATE_TRACE_PLACEHOLDER } from "./mission-legislative-stub.js";
import { isLineDriftFailure } from "./worker-log-line-map.js";

/** Typed trace verification failure — control flow must branch on this, not UI strings. */
export type TraceFailureKind =
  | "ambiguous"
  | "quote_missing"
  | "worker_log_missing"
  | "placeholder_quote"
  | "strict_line_drift"
  | "empty_quote"
  | "anchor_mismatch"
  | "other";

export function classifyTraceFailure(
  reason: string,
  traceQuote: string,
  strictTrace: boolean,
): TraceFailureKind {
  if (reason.startsWith("WORKER_LOG missing:")) return "worker_log_missing";
  if (reason.includes("Ambiguous")) return "ambiguous";
  if (reason.includes("not found verbatim")) {
    if (traceQuote.trim() === LEGISLATE_TRACE_PLACEHOLDER) return "placeholder_quote";
    return "quote_missing";
  }
  if (reason.includes("PASS row has empty")) return "empty_quote";
  if (strictTrace && isLineDriftFailure(reason)) return "strict_line_drift";
  if (
    reason.includes("Trace quote not on anchored line") ||
    reason.includes("No line contains both anchor")
  ) {
    return "anchor_mismatch";
  }
  return "other";
}
