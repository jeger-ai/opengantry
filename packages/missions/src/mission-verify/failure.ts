import type { GxtErrorCode } from "#core/error-codes.js";
import type { DependencyFailureCode } from "#plane/deps-resolve.js";
import type { GateAdapterId } from "#core/gate-adapter.js";
import type { TraceFailureKind } from "../trace-quote.js";
import type { VerifyFinding } from "./finding.js";

export type VerifyFailurePhase =
  | "git_proof"
  | "gate"
  | "trace_pending"
  | "trace"
  | "run_record"
  | "interrogation"
  | "policy"
  | "dependencies"
  | "contract";

interface VerifyFailureBase {
  ok: false;
  message: string;
  exitCode: number;
  executorLogPath: string;
}

export interface GitProofFailure extends VerifyFailureBase {
  phase: "git_proof";
  gitProofMessage: string;
}

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

export interface TracePendingFailure extends VerifyFailureBase {
  phase: "trace_pending";
  gateCommand?: string;
}

export interface TraceFailure extends VerifyFailureBase {
  phase: "trace";
  traceKind: TraceFailureKind;
  traceReason: string;
  traceQuote: string;
  /** 1-based declared line from mission trace anchor when numeric; else 0. */
  declaredLine?: number;
  attestationCommit?: string;
  stalePaths?: string[];
}

type RunRecordFailureKind = "missing" | "mismatch" | "stale";
export interface RunRecordFailure extends VerifyFailureBase {
  phase: "run_record";
  recordKind: RunRecordFailureKind;
  recordReason: string;
  /** Repo-relative path of the record (present or expected). */
  recordPath: string;
  recordHead?: string;
  stalePaths?: string[];
}
export interface InterrogationFailure extends VerifyFailureBase {
  phase: "interrogation";
  interrogationCode: GxtErrorCode;
  interrogationWarnings?: string[];
}

export interface PolicyFailure extends VerifyFailureBase {
  phase: "policy";
  policyCode: GxtErrorCode;
  findings?: VerifyFinding[];
}

export interface DependenciesFailure extends VerifyFailureBase {
  phase: "dependencies";
  dependencyCode: DependencyFailureCode;
  findings?: VerifyFinding[];
}

export interface ContractFailure extends VerifyFailureBase {
  phase: "contract";
  contractCode: GxtErrorCode;
  findings?: VerifyFinding[];
}

/** Discriminated on `phase` — phase-specific fields exist only on their variant. */
export type VerifyPhaseFailure =
  | GitProofFailure
  | GateFailure
  | TracePendingFailure
  | TraceFailure
  | RunRecordFailure
  | InterrogationFailure
  | PolicyFailure
  | DependenciesFailure
  | ContractFailure;
