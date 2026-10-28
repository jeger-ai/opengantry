import type { GxtErrorCode } from "#core/error-codes.js";
import type { GateAdapterId } from "#core/gate-adapter.js";
import type { TraceFailureKind } from "../trace-quote.js";
import type { VerifyFinding } from "./finding.js";

interface VerifyFailureBase {
  ok: false;
  message: string;
  exitCode: number;
  executorLogPath: string;
}

export type GitProofFailure = VerifyFailureBase & { phase: "git_proof" };

export interface GateFailure extends VerifyFailureBase {
  phase: "gate";
  /** Absent only for the "mission has no gate_command" failure. */
  gateCommand?: string;
  /** Combined gate log text (stdout+stderr as streamed to gate_log_path). */
  gateOutput?: string;
  gateAdapter?: GateAdapterId;
  gateExitCode?: number;
  /** Repo-relative path when gate log was streamed to disk. */
  gateLogPath?: string;
  /** Coarse adapter findings when gate subprocess policy failed. */
  adapterFindings?: VerifyFinding[];
}

export type TraceFailure = VerifyFailureBase & {
  phase: "trace";
  traceKind: TraceFailureKind;
  traceQuote: string;
  /** 1-based declared line from mission trace anchor when numeric; else 0. */
  declaredLine?: number;
};
export type TracePendingFailure = VerifyFailureBase & { phase: "trace_pending"; gateCommand?: string };
export type RunRecordFailure = VerifyFailureBase & {
  phase: "run_record";
  recordKind: "missing" | "mismatch" | "stale";
  recordReason: string;
  /** Repo-relative path of the record (present or expected). */
  recordPath: string;
  stalePaths?: string[];
};
/** Phases whose check names its own error code. */
export type CodedFailure<P extends "interrogation" | "policy" | "dependencies" | "contract"> = VerifyFailureBase & {
  phase: P;
  code: GxtErrorCode;
  findings?: VerifyFinding[];
  warnings?: string[];
};

/** Discriminated on `phase` — phase-specific fields exist only on their variant. */
export type VerifyPhaseFailure =
  | GitProofFailure
  | GateFailure
  | TracePendingFailure
  | TraceFailure
  | RunRecordFailure
  | CodedFailure<"interrogation">
  | CodedFailure<"policy">
  | CodedFailure<"dependencies">
  | CodedFailure<"contract">;
