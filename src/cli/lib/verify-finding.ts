import { finalizeVerifyFinding } from "./verify-finding-fingerprint.js";

export const VERIFY_ENVELOPE_SCHEMA_VERSION = 3 as const;

export type VerifyFindingSeverity = "error" | "warning";

export type VerifyFailedGate =
  | "gate"
  | "trace"
  | "git_proof"
  | "defensive"
  | "kpi"
  | "init"
  | "arch"
  | "interrogation";

export interface VerifyFinding {
  failed_gate: VerifyFailedGate;
  offending_file: string;
  line: number;
  severity: VerifyFindingSeverity;
  resolution_hint: string;
  end_line?: number;
  start_column?: number;
  end_column?: number;
  rule_id?: string;
  evidence?: string;
  fingerprint: string;
  semantic_fingerprint: string;
}

export interface VerifyFindingInput {
  offending_file?: string;
  line?: number;
  end_line?: number;
  start_column?: number;
  end_column?: number;
  severity?: VerifyFindingSeverity;
  rule_id?: string;
  evidence?: string;
}

export function verifyFinding(
  failed_gate: VerifyFailedGate,
  resolution_hint: string,
  opts: VerifyFindingInput = {},
): VerifyFinding {
  return finalizeVerifyFinding({
    failed_gate,
    offending_file: opts.offending_file ?? "",
    line: opts.line ?? 0,
    severity: opts.severity ?? "error",
    resolution_hint,
    ...(opts.end_line !== undefined ? { end_line: opts.end_line } : {}),
    ...(opts.start_column !== undefined ? { start_column: opts.start_column } : {}),
    ...(opts.end_column !== undefined ? { end_column: opts.end_column } : {}),
    ...(opts.rule_id !== undefined ? { rule_id: opts.rule_id } : {}),
    ...(opts.evidence !== undefined ? { evidence: opts.evidence } : {}),
  });
}
