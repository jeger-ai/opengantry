import type { VerifyEvaluation } from "#missions/mission-verify/options.js";
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
  format?: "json" | "sarif" | "junit";
  /** Verify every mission file changed vs base ref on current branch. */
  changedMissions?: boolean;
  /** After a pass with a run record, write the export envelope 2.0 over it (ADR-0061). */
  exportPath?: string;
  /** `--sign` with `--export`: sign the envelope with the git signing key (keyless is `--contract` only). */
  sign?: boolean | string;
}
