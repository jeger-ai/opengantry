import type { VerifyFinding } from "../mission-verify/finding.js";
import type { GateAdapterId } from "#core/gate-adapter.js";

export interface GateExecContext {
  cwd: string;
  /** Repository root for repo-relative `offending_file`; defaults to `cwd`. */
  repoRoot?: string;
  /** Absolute path for streaming gate subprocess I/O. */
  gateLogPath: string;
  successSubstring: string | null;
}

export interface GateExecutionResult {
  exitCode: number | null;
  adapter_id: GateAdapterId | string;
  findings: VerifyFinding[];
}

export type GateExecAdapter = (
  command: string,
  ctx: GateExecContext,
) => Promise<GateExecutionResult>;
