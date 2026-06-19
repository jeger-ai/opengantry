import type { GxtErrorCode } from "./gxt-error-codes.js";
import type { AudienceTaggedStep } from "./verify-hints.js";
import type { RemediationSnapshot } from "./context-feed-store.js";

/** Canonical verify-failure contract — single mapping for all sinks. */
export interface NormalizedVerifyFailure {
  phase: string;
  message: string;
  exit_code: number;
  error_code: GxtErrorCode;
  fix_hints: string[];
  next_actions: string[];
  tagged_steps?: AudienceTaggedStep[];
  headline: string;
  detail_lines: string[];
  stdout?: string;
  stderr?: string;
  failures?: string[];
  gate?: RemediationSnapshot["gate"];
  kpi?: RemediationSnapshot["kpi"];
  presentation_gate?: { stdout?: string; stderr?: string; exitCode?: number };
  trace?: { failures?: string[] };
  mission_file_path?: string;
  msn_id?: string;
}

export type NormalizedVerifyFailureBase = Pick<
  NormalizedVerifyFailure,
  | "phase"
  | "message"
  | "exit_code"
  | "error_code"
  | "fix_hints"
  | "next_actions"
  | "tagged_steps"
  | "mission_file_path"
  | "msn_id"
>;
