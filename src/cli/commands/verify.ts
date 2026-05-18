import path from "node:path";
import { CLI_NAME } from "../lib/constants.js";
import {
  assertBypassSecretAuthorized,
  runBreakGlassAudit,
  validateBreakGlassReason,
} from "../lib/break-glass.js";
import {
  hintGate,
  hintTeacherEmails,
  hintTraceAmbiguous,
  hintTraceMissing,
  hintTraceStrictTrace,
  logFixHint,
} from "../lib/fix-hints.js";
import { assertTeacherMissionProof } from "../lib/git-proof.js";
import { logError, logInfo, setExitCode } from "../lib/cli-io.js";
import { gatePassed, runGate } from "../lib/gate.js";
import { assertMissionGatePresent, parseMissionFile } from "../lib/mission-parser.js";
import { isLineDriftFailure } from "../lib/worker-log-line-map.js";
import { defaultWorkerLogPath, verifyTraceRows } from "../lib/trace.js";
import { loadWorkspace } from "../lib/workspace.js";

export interface VerifyOptions {
  mission: string;
  workerLog?: string;
  cwd?: string;
  fuzzyTrace?: boolean;
  strictTrace?: boolean;
  breakGlass?: boolean;
  breakGlassReason?: string;
  breakGlassCommit?: string;
  auditCommit?: boolean;
}

export function runVerify(options: VerifyOptions): void {
  const { root } = loadWorkspace();
  const mission = parseMissionFile(root, options.mission);
  assertMissionGatePresent(mission);
  const missionArg = options.mission;

  if (options.breakGlass === true) {
    try {
      const reason = validateBreakGlassReason(options.breakGlassReason);
      assertBypassSecretAuthorized(root);
      const missionRel = path
        .relative(root, path.resolve(mission.rawPath))
        .split(path.sep)
        .join("/");
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
      return;
    } catch (e) {
      logError(e instanceof Error ? e.message : String(e));
      setExitCode(2);
      return;
    }
  }

  let proofMsnId: string;
  try {
    proofMsnId = assertTeacherMissionProof(root, mission.rawPath, {
      msnId: mission.msnId ?? undefined,
    });
  } catch (e) {
    logError(e instanceof Error ? e.message : String(e));
    logFixHint(hintTeacherEmails(root));
    setExitCode(1);
    return;
  }
  logInfo(`${CLI_NAME} verify: git-proof OK (Teacher legislation for ${proofMsnId})`);

  const gate = mission.gate!;
  const workDir = options.cwd ? path.resolve(root, options.cwd) : root;
  const workerLogPath = options.workerLog
    ? path.resolve(root, options.workerLog)
    : defaultWorkerLogPath(root);

  const gateResult = runGate(workDir, gate);
  if (!gatePassed(gateResult, gate.successSubstring)) {
    logError("verify: GATE FAILED");
    logError("--- stdout ---\n" + gateResult.stdout);
    logError("--- stderr ---\n" + gateResult.stderr);
    logError(`exit code: ${String(gateResult.exitCode)}`);
    logFixHint(hintGate(gate.command, missionArg));
    setExitCode(1);
    return;
  }
  logInfo(`${CLI_NAME} verify: gate passed`);

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
      } else if (failure.reason.includes("not found verbatim") || failure.reason.includes("WORKER_LOG missing")) {
        logFixHint(hintTraceMissing(workerLogPath));
      } else if (options.strictTrace && isLineDriftFailure(failure.reason)) {
        logFixHint(hintTraceStrictTrace(missionArg));
      }
    }
    setExitCode(1);
    return;
  }

  for (const warning of traceResult.warnings) {
    const tag = warning.autoResolved ? "auto-resolved" : "drift";
    logInfo(
      `  trace: line ${tag} DoD ${warning.row.dodId} — declared ${String(warning.declaredLine)}, found ${String(warning.foundLine)}`,
    );
  }
  logInfo(`${CLI_NAME} verify: trace mapping OK (${workerLogPath})`);
}
