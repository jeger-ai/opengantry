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
  hintTraceStrictTrace,
  logFixHint,
} from "./fix-hints.js";
import { assertTeacherMissionProof } from "./git-proof.js";
import { logError, logInfo, setExitCode } from "./cli-io.js";
import { reportUserFacingError } from "./user-error.js";
import { gatePassed, runGate } from "./gate.js";
import type { ParsedMission } from "./types.js";
import { isLineDriftFailure } from "./worker-log-line-map.js";
import { defaultWorkerLogPath, verifyTraceRows } from "./trace.js";
import type { VerifyOptions } from "./verify-types.js";

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

export function runVerifyGate(
  root: string,
  mission: ParsedMission,
  missionArg: string,
  options: VerifyOptions,
): boolean {
  const gate = mission.gate!;
  const workDir = options.cwd ? path.resolve(root, options.cwd) : root;
  const gateResult = runGate(workDir, gate);
  if (!gatePassed(gateResult, gate.successSubstring)) {
    logError("verify: GATE FAILED");
    logError("--- stdout ---\n" + gateResult.stdout);
    logError("--- stderr ---\n" + gateResult.stderr);
    logError(`exit code: ${String(gateResult.exitCode)}`);
    logFixHint(hintGate(gate.command, missionArg));
    setExitCode(1);
    return false;
  }
  logInfo(`${CLI_NAME} verify: gate passed`);
  return true;
}

export function runVerifyTrace(
  root: string,
  mission: ParsedMission,
  missionArg: string,
  options: VerifyOptions,
): boolean {
  const workerLogPath = options.workerLog
    ? path.resolve(root, options.workerLog)
    : defaultWorkerLogPath(root);

  const traceResult = verifyTraceRows(workerLogPath, mission.traceRows, {
    fuzzyNumericAnchor: options.fuzzyTrace === true,
    strictTrace: options.strictTrace === true,
  });

  if (traceResult.failures.length > 0) {
    logError("verify: TRACE MAPPING FAILED (Evidence Tampering / missing evidence)");
    for (const failure of traceResult.failures) {
      logError(`  DoD ${failure.row.dodId}: ${failure.reason}`);
      if (failure.reason.includes("Ambiguous")) {
        logFixHint(hintTraceAmbiguous(workerLogPath, missionArg));
      } else if (
        failure.reason.includes("not found verbatim") ||
        failure.reason.includes("WORKER_LOG missing")
      ) {
        logFixHint(hintTraceMissing(workerLogPath));
      } else if (options.strictTrace && isLineDriftFailure(failure.reason)) {
        logFixHint(hintTraceStrictTrace(missionArg));
      }
    }
    setExitCode(1);
    return false;
  }

  for (const warning of traceResult.warnings) {
    const tag = warning.autoResolved ? "auto-resolved" : "drift";
    logInfo(
      `  trace: line ${tag} DoD ${warning.row.dodId} — declared ${String(warning.declaredLine)}, found ${String(warning.foundLine)}`,
    );
  }
  logInfo(`${CLI_NAME} verify: trace mapping OK (${workerLogPath})`);
  return true;
}
