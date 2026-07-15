export {
  type NormalizedTraceStatus,
  normalizeTraceStatus,
  isPassStatus,
  isPendingStatus,
  isPassTraceRow,
} from "./trace-status.js";

export {
  type TraceFailureKind,
  type TraceVerifyFailure,
  type TraceVerifyWarning,
  type TraceVerifyOptions,
  type ResolvedQuoteLine,
  type TraceVerifyResult,
  resolveQuoteLineNumber,
  verifyTraceRows,
  defaultExecutorLogPath,
} from "./trace-quote.js";

export {
  UNCOMMITTED_BLAME_COMMIT,
  type TraceEvidenceFailure,
  type TraceEvidenceOptions,
  parseBlamePorcelainByLine,
  readBlamePorcelainByLine,
  verifyTraceEvidenceFreshness,
} from "./trace-evidence.js";
