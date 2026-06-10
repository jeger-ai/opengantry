import { CLI_NAME } from "./constants.js";
import {
  logFixHint,
} from "./fix-hints.js";
import { logError, setExitCode } from "./cli-io.js";
import type { GxtErrorCode } from "./gxt-error-codes.js";
import type { VerifyPhaseFailure } from "./verify-engine.js";
import type { VerifyOptions } from "./verify-types.js";
import { buildVerifyRemediation } from "./verify-remediation.js";

export interface VerifyFailurePresentationInput {
  failure: VerifyPhaseFailure;
  missionArg: string;
  options: Pick<VerifyOptions, "strictTrace" | "audience">;
  root?: string;
  msnId?: string;
}

export interface VerifyFailurePresentation {
  error_code: GxtErrorCode;
  headline: string;
  detail_lines: string[];
  fix_hints: string[];
  next_actions: string[];
  exit_code: number;
  gate?: { stdout?: string; stderr?: string; exitCode?: number };
  trace?: { failures?: string[] };
}

function failureHintContext(
  failure: VerifyPhaseFailure,
  missionArg: string,
  options: Pick<VerifyOptions, "strictTrace">,
  root?: string,
  msnId?: string,
) {
  return {
    root,
    missionPath: missionArg,
    msnId,
    workerLogPath: failure.workerLogPath,
    gateCommand: failure.gateCommand,
    gitProofMessage: failure.gitProofMessage ?? failure.message,
    traceKind: failure.traceKind,
    traceQuote: failure.traceQuote,
    traceFailureReason: failure.traceReason,
    strictTrace: options.strictTrace,
  };
}

export function verifyFailurePresentation(
  input: VerifyFailurePresentationInput,
): VerifyFailurePresentation {
  const { failure, missionArg, root, msnId, options } = input;
  const remediation = buildVerifyRemediation(
    failure.phase,
    failureHintContext(failure, missionArg, options, root, msnId),
  );
  const base = {
    error_code: remediation.error_code,
    fix_hints: remediation.fix_hints,
    next_actions: remediation.next_actions,
    exit_code: failure.exitCode,
  };

  switch (failure.phase) {
    case "git_proof":
      return {
        ...base,
        headline: failure.message,
        detail_lines: [],
      };
    case "gate":
      return {
        ...base,
        headline: "verify: GATE FAILED",
        detail_lines: [
          ...(failure.gateStdout !== undefined ? [`--- stdout ---\n${failure.gateStdout}`] : []),
          ...(failure.gateStderr !== undefined ? [`--- stderr ---\n${failure.gateStderr}`] : []),
          ...(failure.gateExitCode !== undefined ? [`exit code: ${String(failure.gateExitCode)}`] : []),
        ],
        gate: {
          stdout: failure.gateStdout,
          stderr: failure.gateStderr,
          exitCode: failure.gateExitCode,
        },
      };
    case "trace_pending":
      return {
        ...base,
        headline: `${CLI_NAME} verify: legislative stub complete (git-proof OK) — worker must execute, append ${failure.workerLogPath}, set trace row PASS, then re-verify`,
        detail_lines: [],
      };
    case "trace":
      return {
        ...base,
        headline: "verify: TRACE MAPPING FAILED (Evidence Tampering / missing evidence)",
        detail_lines: [`DoD trace failure: ${failure.traceReason ?? failure.message}`],
        trace: failure.traceReason
          ? { failures: [`DoD trace: ${failure.traceReason}`] }
          : undefined,
      };
    default: {
      const _exhaustive: never = failure.phase;
      return _exhaustive;
    }
  }
}

/** CLI default channel: log presentation and set exit code. */
export function emitVerifyFailureFromPresentation(presentation: VerifyFailurePresentation): void {
  logError(`[${presentation.error_code}] ${presentation.headline}`);
  for (const line of presentation.detail_lines) {
    if (line.startsWith("---")) logError(line);
    else logError(`  ${line}`);
  }
  for (const hint of presentation.fix_hints) {
    logFixHint(hint);
  }
  setExitCode(presentation.exit_code);
}
