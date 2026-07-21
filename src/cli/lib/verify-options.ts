import type { OutputAudience } from "./audience-output.js";
import type { VerifyExportFormat } from "./verify-export.js";

/** High-level verify execution mode — sinks derive from this + export format. */
export type VerifyMode = "normal" | "pre_push" | "break_glass" | "fix" | "json";

export interface VerifyOptions {
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
  /** Structured export format (json default when --json). */
  format?: VerifyExportFormat;
  /** Verify every mission file changed vs base ref on current branch. */
  changedMissions?: boolean;
  /** Base ref for --changed-missions (default: merge-base with origin/HEAD or main). */
  baseRef?: string;
  /** Authoritative mode: fail-closed on KPI stale evidence and perimeter (CI). */
  ci?: boolean;
  /** Max commits to scan for Planner [MSN-XXXX] stamp (overrides GXT_MSN_SCAN_DEPTH). */
  scanDepth?: number;
  /** Write attestation receipt after verify (optional path; default .gitagent/history/receipts/). */
  receipt?: boolean | string;
  /** Detach-sign receipt with local SSH/GPG key (also when receipt_signature tier is warn/require). */
  signReceipt?: boolean;
}

/** Resolve the primary verify mode from CLI flags (single discriminant for sinks). */
export function resolveVerifyMode(options: VerifyOptions): VerifyMode {
  if (options.breakGlass === true) return "break_glass";
  if (options.prePush === true) return "pre_push";
  if (options.json === true || options.format !== undefined) return "json";
  if (options.fix === true) return "fix";
  return "normal";
}
