import type { GateExecAdapter } from "../gate-adapters/gate-adapter-types.js";

/** What the domain evaluates; the CLI's VerifyOptions (src/cli/flows/verify-options.ts) adds how it presents and records. */
export interface VerifyEvaluation {
  mission?: string;
  executorLog?: string;
  cwd?: string;
  fuzzyTrace?: boolean;
  strictTrace?: boolean;
  /** Pre-push handoff: legislative stubs stop after git-proof; others run full verify. */
  prePush?: boolean;
  breakGlass?: boolean;
  breakGlassReason?: string;
  breakGlassCommit?: string;
  auditCommit?: boolean;
  /** Skip TMVC stale-evidence binding (committed PASS quote lines only). */
  skipStaleEvidence?: boolean;
  /** After a full pass on a clean committed tree, write .gitagent/runs/<MSN>.json (ADR-0052 A5). */
  record?: boolean;
  /** Base ref for --changed-missions (default: merge-base with origin/HEAD or main). */
  baseRef?: string;
  /** Authoritative mode: fail-closed on KPI stale evidence and perimeter (CI). */
  ci?: boolean;
  /** Max commits to scan for Planner [MSN-XXXX] stamp (overrides GANTRY_MSN_SCAN_DEPTH). */
  scanDepth?: number;
  /** Require interrogation block on mission (CI hard mode). */
  requireInterrogation?: boolean;
  /** Override gate subprocess execution (default: generic spawn adapter). */
  gateExecAdapter?: GateExecAdapter;
}

