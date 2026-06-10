import { CLI_NAME } from "./constants.js";
import { runBreakGlassAuditFlow } from "./break-glass-flow.js";
import { logFixHint } from "./fix-hints.js";
import { errorMessage, logError, logInfo, setExitCode } from "./cli-io.js";
import { reportUserFacingError } from "./user-error.js";
import type { Manifest, ParsedMission } from "./types.js";
import {
  evaluateVerifyPhases,
  type VerifyPhaseFailure,
  type VerifyPhaseSuccess,
} from "./verify-engine.js";
import type { VerifyOptions } from "./verify-types.js";
import {
  emitVerifyFailureFromPresentation,
  verifyFailurePresentation,
} from "./verify-failure-presentation.js";
import { CommandReporter } from "./command-reporter.js";
import type { VerifyResultPayload } from "./verify-result-payload.js";

export function runVerifyBreakGlass(
  root: string,
  mission: ParsedMission,
  options: VerifyOptions,
): boolean {
  const outcome = runBreakGlassAuditFlow(root, mission, options);
  if (outcome.kind === "fail") {
    logError(errorMessage(outcome.error));
    setExitCode(2);
    return false;
  }
  logInfo(`${CLI_NAME} verify: BREAK-GLASS — all gates skipped (audited on ${outcome.commitSha})`);
  logInfo(`  reason: ${outcome.reason}`);
  if (outcome.msnId) logInfo(`  msn_id: ${outcome.msnId}`);
  if (outcome.auditCommit) {
    logFixHint("git push origin HEAD  # audit empty commit (no gxt-bypass note)");
  } else {
    logFixHint("git push origin refs/notes/gxt-bypass");
  }
  return true;
}

export function emitVerifySuccess(result: VerifyPhaseSuccess, _missionArg: string): void {
  logInfo(`${CLI_NAME} verify: git-proof OK (Teacher legislation for ${result.proofMsnId})`);
  if (result.outcome === "pre_push_stub") {
    logInfo(
      `${CLI_NAME} verify: legislative stub OK (remote handoff; git-proof passed — run full verify after execution)`,
    );
    return;
  }
  logInfo(`${CLI_NAME} verify: gate passed`);
  for (const warning of result.traceWarnings) {
    const tag = warning.autoResolved ? "auto-resolved" : "drift";
    logInfo(
      `  trace: line ${tag} DoD ${warning.row.dodId} — declared ${String(warning.declaredLine)}, found ${String(warning.foundLine)}`,
    );
  }
  if (result.traceEvidenceSkippedUncommitted !== undefined) {
    logInfo(
      `  trace evidence: ${String(result.traceEvidenceSkippedUncommitted)} uncommitted WORKER_LOG line(s) skipped stale check`,
    );
  }
  logInfo(`${CLI_NAME} verify: trace mapping OK (${result.workerLogPath})`);
}

function emitVerifyFailure(failure: VerifyPhaseFailure, missionArg: string, options: VerifyOptions, root?: string, msnId?: string): void {
  if (failure.phase === "git_proof") {
    reportUserFacingError(new Error(failure.message));
    return;
  }
  const presentation = verifyFailurePresentation({
    failure,
    missionArg,
    options,
    root,
    msnId,
  });
  emitVerifyFailureFromPresentation(presentation);
}

export function emitVerifyPhaseResult(
  result: VerifyPhaseSuccess | VerifyPhaseFailure,
  missionArg: string,
  options: VerifyOptions = { mission: missionArg },
  root?: string,
  msnId?: string,
): boolean {
  if (!result.ok) {
    emitVerifyFailure(result, missionArg, options, root, msnId);
    return false;
  }
  emitVerifySuccess(result, missionArg);
  return true;
}

/** Run full verify (after gate present) using shared phase engine. Returns true on success. */
export function runVerifyPhasesFromEngine(
  root: string,
  mission: ParsedMission,
  missionArg: string,
  options: VerifyOptions,
  manifest: Manifest,
): boolean {
  const result = evaluateVerifyPhases(root, mission, options, manifest);
  return emitVerifyPhaseResult(result, missionArg, options, root, mission.msnId ?? undefined);
}

export function verifyFailureToHintContext(
  failure: VerifyPhaseFailure,
  missionArg: string,
  options: VerifyOptions,
  root?: string,
) {
  return {
    root,
    missionPath: missionArg,
    workerLogPath: failure.workerLogPath,
    gateCommand: failure.gateCommand,
    gitProofMessage: failure.gitProofMessage,
    traceKind: failure.traceKind,
    traceQuote: failure.traceQuote,
    traceFailureReason: failure.traceReason,
    strictTrace: options.strictTrace,
  };
}

export function emitVerifyJson(payload: VerifyResultPayload): void {
  logInfo(JSON.stringify(payload, null, 2));
  if (payload.exit_code !== 0) setExitCode(payload.exit_code);
}

export function emitAudienceNextSteps(
  steps: string[],
  options: VerifyOptions,
  tagged?: import("./verify-remediation.js").AudienceTaggedStep[],
): void {
  const reporter = CommandReporter.forVerify(options);
  reporter.emitNextSteps(steps, tagged);
}
