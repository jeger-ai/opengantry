import type { GxtErrorCode } from "./gxt-error-codes.js";
import type { DependencyFailureCode } from "./deps/deps-resolve.js";
import type { GateAdapterId, KpiThresholdOp } from "./types.js";
import type { TraceFailureKind } from "./trace.js";
import type { VerifyFinding } from "./verify-finding.js";

export type VerifyFailurePhase =
  | "git_proof"
  | "gate"
  | "defensive"
  | "kpi"
  | "trace_pending"
  | "trace"
  | "interrogation"
  | "policy"
  | "dependencies";

export type KpiFailureKind = "missing" | "invalid" | "stale" | "threshold" | "exit_code";

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

export interface DefensiveFailure extends VerifyFailureBase {
  phase: "defensive";
  defensiveReason: string;
  defensiveNetLoc?: number;
  defensiveMaxNetLoc?: number;
  defensiveWarnings?: string[];
  defensiveAudits?: string[];
}

export interface KpiFailure extends VerifyFailureBase {
  phase: "kpi";
  kpiKind: KpiFailureKind;
  kpiReason: string;
  kpiReportPath: string;
  kpiMetric?: string;
  kpiOp?: KpiThresholdOp;
  kpiExpected?: number;
  kpiActual?: number | boolean;
  kpiStalePaths?: string[];
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

/** Discriminated on `phase` — phase-specific fields exist only on their variant. */
export type VerifyPhaseFailure =
  | GitProofFailure
  | GateFailure
  | DefensiveFailure
  | KpiFailure
  | TracePendingFailure
  | TraceFailure
  | InterrogationFailure
  | PolicyFailure
  | DependenciesFailure;
