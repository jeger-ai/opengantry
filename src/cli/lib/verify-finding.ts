export const VERIFY_ENVELOPE_SCHEMA_VERSION = 2 as const;

export type VerifyFindingSeverity = "error" | "warning";

export type VerifyFailedGate =
  | "gate"
  | "trace"
  | "git_proof"
  | "defensive"
  | "kpi"
  | "init"
  | "arch";

export interface VerifyFinding {
  failed_gate: VerifyFailedGate;
  offending_file: string;
  line: number;
  severity: VerifyFindingSeverity;
  resolution_hint: string;
}

export function verifyFinding(
  failed_gate: VerifyFailedGate,
  resolution_hint: string,
  opts: { offending_file?: string; line?: number; severity?: VerifyFindingSeverity } = {},
): VerifyFinding {
  return {
    failed_gate,
    offending_file: opts.offending_file ?? "",
    line: opts.line ?? 0,
    severity: opts.severity ?? "error",
    resolution_hint,
  };
}
