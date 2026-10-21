/**
 * The exit-code table (ADR-0052 A7). A gantry command exits with one of these three codes or passes a child
 * process's code through unchanged (gantry cage, gantry runtime exec, the gate). Commands set it through
 * setExitCode in src/cli/output/cli-io.ts; there is no other ladder.
 */
export const EXIT_CODE = Object.freeze({
  /** The command ran and the answer is yes: checks passed, the document was written. */
  OK: 0,
  /** The command ran and the answer is no: a failed gate, a failed check, a policy violation, an error. */
  FAILURE: 1,
  /** The invocation is wrong: unknown or conflicting options, a bad value, a missing file or precondition. */
  USAGE: 2,
});

export type ExitCode = (typeof EXIT_CODE)[keyof typeof EXIT_CODE];
