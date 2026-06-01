import path from "node:path";
import { CLI_NAME } from "./constants.js";
import {
  assertBypassSecretAuthorized,
  runBreakGlassAudit,
  validateBreakGlassReason,
} from "./break-glass.js";
import {
  hintGate,
  hintTraceAmbiguous,
  hintTraceMissing,
  hintTraceQuoteStillPlaceholder,
  hintTraceStrictTrace,
  logFixHint,
} from "./fix-hints.js";
import { GXT_ERROR } from "./gxt-error-codes.js";
import { assertTeacherMissionProof } from "./git-proof.js";
import { logError, logInfo, setExitCode } from "./cli-io.js";
import { reportUserFacingError } from "./user-error.js";
import type { ParsedMission } from "./types.js";
import {
  evaluateVerifyPhases,
  type VerifyPhaseFailure,
  type VerifyPhaseSuccess,
} from "./verify-engine.js";
import type { VerifyOptions } from "./verify-types.js";
import {
  filterNextStepsForAudience,
  audienceSectionTitle,
  formatAudienceNextStep,
} from "./audience-output.js";
import { getOutputAudience } from "./output-context.js";

export function runVerifyBreakGlass(
  root: string,
  mission: ParsedMission,
  options: VerifyOptions,
): boolean {
  try {
    const reason = validateBreakGlassReason(options.breakGlassReason);
    assertBypassSecretAuthorized(root);
    const missionRel = path.relative(root, path.resolve(mission.rawPath)).split(path.sep).join("/");
    const commitSha = runBreakGlassAudit(root, {
      reason,
      msnId: mission.msnId,
      missionFile: missionRel,
      commit: options.breakGlassCommit,
      auditCommit: options.auditCommit === true,
    });
    logInfo(`${CLI_NAME} verify: BREAK-GLASS — all gates skipped (audited on ${commitSha})`);
    logInfo(`  reason: ${reason}`);
    if (mission.msnId) logInfo(`  msn_id: ${mission.msnId}`);
    if (options.auditCommit === true) {
      logFixHint("git push origin HEAD  # audit empty commit (no gxt-bypass note)");
    } else {
      logFixHint("git push origin refs/notes/gxt-bypass");
    }
    return true;
  } catch (e) {
    logError(e instanceof Error ? e.message : String(e));
    setExitCode(2);
    return false;
  }
}

/** @deprecated Prefer evaluateVerifyPhases — kept for callers that only need git-proof logging. */
export function runVerifyGitProof(root: string, mission: ParsedMission): string | null {
  try {
    const proofMsnId = assertTeacherMissionProof(root, mission.rawPath, {
      msnId: mission.msnId ?? undefined,
    });
    logInfo(`${CLI_NAME} verify: git-proof OK (Teacher legislation for ${proofMsnId})`);
    return proofMsnId;
  } catch (e) {
    reportUserFacingError(e);
    return null;
  }
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
  logInfo(`${CLI_NAME} verify: trace mapping OK (${result.workerLogPath})`);
}

function emitVerifyFailure(failure: VerifyPhaseFailure, missionArg: string): void {
  switch (failure.phase) {
    case "git_proof":
      reportUserFacingError(new Error(failure.message));
      return;
    case "gate":
      logError(`[${GXT_ERROR.GATE_FAILED}] verify: GATE FAILED`);
      if (failure.gateStdout !== undefined) logError("--- stdout ---\n" + failure.gateStdout);
      if (failure.gateStderr !== undefined) logError("--- stderr ---\n" + failure.gateStderr);
      if (failure.gateExitCode !== undefined) logError(`exit code: ${String(failure.gateExitCode)}`);
      logFixHint(hintGate(failure.gateCommand ?? "<gate>", missionArg));
      setExitCode(failure.exitCode);
      return;
    case "trace_pending":
      logError(
        `[${GXT_ERROR.TRACE_PENDING}] ${CLI_NAME} verify: legislative stub complete (git-proof OK) — worker must execute, append ${failure.workerLogPath}, set trace row PASS, then re-verify`,
      );
      setExitCode(failure.exitCode);
      return;
    case "trace": {
      const errorCode =
        failure.traceKind === "ambiguous" ? GXT_ERROR.TRACE_AMBIGUOUS : GXT_ERROR.TRACE_MISSING;
      logError(`[${errorCode}] verify: TRACE MAPPING FAILED (Evidence Tampering / missing evidence)`);
      logError(`  DoD trace failure: ${failure.traceReason ?? failure.message}`);
      switch (failure.traceKind) {
        case "ambiguous":
          logFixHint(
            hintTraceAmbiguous(failure.workerLogPath, missionArg, failure.traceQuote),
          );
          break;
        case "placeholder_quote":
          logFixHint(hintTraceQuoteStillPlaceholder(missionArg, failure.workerLogPath));
          break;
        case "strict_line_drift":
          logFixHint(hintTraceStrictTrace(missionArg));
          break;
        case "quote_missing":
        case "worker_log_missing":
        case "empty_quote":
        case "anchor_mismatch":
        case "other":
        default:
          logFixHint(hintTraceMissing(failure.workerLogPath));
          break;
      }
      setExitCode(failure.exitCode);
    }
  }
}

export function emitVerifyPhaseResult(
  result: VerifyPhaseSuccess | VerifyPhaseFailure,
  missionArg: string,
): boolean {
  if (!result.ok) {
    emitVerifyFailure(result, missionArg);
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
): boolean {
  const result = evaluateVerifyPhases(root, mission, options);
  return emitVerifyPhaseResult(result, missionArg);
}

/** @deprecated Prefer runVerifyPhasesFromEngine gate phase. */
export function runVerifyGate(
  root: string,
  mission: ParsedMission,
  missionArg: string,
  options: VerifyOptions,
): boolean {
  const result = evaluateVerifyPhases(root, mission, options);
  if (!result.ok && result.phase === "gate") {
    emitVerifyFailure(result, missionArg);
    return false;
  }
  if (!result.ok) {
    emitVerifyFailure(result, missionArg);
    return false;
  }
  logInfo(`${CLI_NAME} verify: gate passed`);
  return true;
}

/** @deprecated Prefer runVerifyPhasesFromEngine trace phase. */
export function runVerifyTrace(
  root: string,
  mission: ParsedMission,
  missionArg: string,
  options: VerifyOptions,
): boolean {
  const result = evaluateVerifyPhases(root, mission, options);
  if (!result.ok) {
    emitVerifyFailure(result, missionArg);
    return false;
  }
  emitVerifySuccess(result, missionArg);
  return true;
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
    strictTrace: options.strictTrace,
  };
}

export function emitAudienceNextSteps(steps: string[], options: VerifyOptions): void {
  const audience = options.audience ?? getOutputAudience();
  const filtered = filterNextStepsForAudience(audience, steps).map((step) =>
    formatAudienceNextStep(step, audience),
  );
  const section = audienceSectionTitle(audience);
  if (section && filtered.length > 0) {
    logInfo(`${section}:`);
    for (const step of filtered) logInfo(`  ${step}`);
  } else {
    logInfo("next actions:");
    for (const action of filtered) logInfo(`  ${action}`);
  }
}
