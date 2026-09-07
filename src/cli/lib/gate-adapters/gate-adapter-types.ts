import type { VerifyFinding } from "../verify-finding.js";

export interface GateExecContext {
  msn_id: string;
  /** Absolute path for streaming gate subprocess I/O. */
  gate_log_path: string;
  cwd: string;
  /** Repository root for repo-relative `offending_file`; defaults to `cwd`. */
  repo_root?: string;
  successSubstring?: string | null;
}

export interface GateExecutionResult {
  exitCode: number | null;
  adapter_id: string;
  findings: VerifyFinding[];
}

export interface GateExecAdapter {
  readonly adapter_id: string;
  execute(command: string, ctx: GateExecContext): Promise<GateExecutionResult>;
}
