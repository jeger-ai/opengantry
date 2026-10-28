export const VERIFY_ENVELOPE_SCHEMA_VERSION = 4 as const;

export type VerifyFindingSeverity = "error" | "warning";

export type VerifyFailedGate =
  | "gate"
  | "trace"
  | "git_proof"
  | "defensive"
  | "init"
  | "arch"
  | "interrogation"
  | "policy"
  | "dependencies"
  | "contract";

/** A finding names a rule at a file and line; it never carries source or gate output text. */
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
}

/** A finding with the coordinates given; the rest default to no file, line 0 and error. */
export function verifyFinding(
  failed_gate: VerifyFailedGate,
  resolution_hint: string,
  opts: Partial<Omit<VerifyFinding, "failed_gate" | "resolution_hint">> = {},
): VerifyFinding {
  return { failed_gate, offending_file: "", line: 0, severity: "error", resolution_hint, ...opts };
}
