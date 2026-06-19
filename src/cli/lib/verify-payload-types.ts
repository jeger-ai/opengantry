import type { GxtErrorCode } from "./gxt-error-codes.js";

export interface VerifyTraceWarningJson {
  dod_id: string;
  declared_line: number;
  found_line: number;
  auto_resolved?: boolean;
}

export interface VerifyPassedPayload {
  status: "passed";
  phase: "full" | "pre_push_stub" | "break_glass";
  exit_code: 0;
  msn_id?: string;
  mission_file_path?: string;
  message?: string;
  audit_commit?: string;
  trace_warnings?: VerifyTraceWarningJson[];
  kpi_warnings?: string[];
  trace_evidence_skipped_uncommitted?: number;
}

export interface VerifyFailedPayload {
  status: "failed";
  phase: string;
  message: string;
  error_code: GxtErrorCode;
  fix_hints: string[];
  next_actions: string[];
  exit_code: number;
  stdout?: string;
  stderr?: string;
  failures?: string[];
}

export type VerifyResultPayload = VerifyPassedPayload | VerifyFailedPayload;
