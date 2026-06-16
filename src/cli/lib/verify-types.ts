import type { OutputAudience } from "./audience-output.js";

export interface VerifyOptions {
  mission?: string;
  workerLog?: string;
  cwd?: string;
  fuzzyTrace?: boolean;
  strictTrace?: boolean;
  /** Pre-push handoff: legislative stubs stop after git-proof; others run full verify. */
  prePush?: boolean;
  breakGlass?: boolean;
  breakGlassReason?: string;
  breakGlassCommit?: string;
  auditCommit?: boolean;
  /** Interactive remediation menu on failure. */
  fix?: boolean;
  /** Print structured fix hints without prompts (used with --fix). */
  fixNonInteractive?: boolean;
  /** Tailor remediation next steps by role. */
  audience?: OutputAudience;
  /** Skip TMVC stale-evidence binding (committed PASS quote lines only). */
  skipStaleEvidence?: boolean;
  /** Emit a single structured JSON document on stdout (no human logs). */
  json?: boolean;
  /** Verify every mission file changed vs base ref on current branch. */
  changedMissions?: boolean;
  /** Base ref for --changed-missions (default: merge-base with origin/HEAD or main). */
  baseRef?: string;
  /** Authoritative mode: fail-closed on KPI stale evidence and perimeter (CI). */
  ci?: boolean;
  /** Max commits to scan for Teacher [MSN-XXXX] stamp (overrides GXT_MSN_SCAN_DEPTH). */
  scanDepth?: number;
}
