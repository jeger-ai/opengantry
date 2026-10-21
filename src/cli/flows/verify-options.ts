import type { VerifyEvaluation } from "#missions/mission-verify/options.js";
import type { VerifyExportFormat } from "#missions/mission-verify/export.js";
import type { OutputAudience } from "#missions/mission-verify/hints.js";

/** The verify command's options: the evaluation the domain runs, plus how the CLI presents and records it. */
export interface VerifyOptions extends VerifyEvaluation {
  /** Interactive remediation menu on failure. */
  fix?: boolean;
  /** Print structured fix hints without prompts (used with --fix). */
  fixNonInteractive?: boolean;
  /** Tailor remediation next steps by role. */
  audience?: OutputAudience;
  /** Emit a single structured JSON document on stdout (no human logs). */
  json?: boolean;
  /** Write structured JSON payload to a file (pipe-safe; used by kernel sync shim). */
  jsonOut?: string;
  /** Structured export format (json default when --json). */
  format?: VerifyExportFormat;
  /** Verify every mission file changed vs base ref on current branch. */
  changedMissions?: boolean;
  /** Write attestation receipt after verify (optional path; default .gitagent/history/receipts/). */
  receipt?: boolean | string;
  /** Detach-sign receipt with local SSH/GPG key (also when receipt_signature tier is warn/require). */
  signReceipt?: boolean;
  /** Write hub export envelope after verify (payload_b64 + signature). */
  exportPath?: string;
}
