import path from "node:path";
import {
  assertBypassSecretAuthorized,
  runBreakGlassAudit,
  validateBreakGlassReason,
} from "../lib/break-glass.js";
import { assertMissionGatePresent, parseMissionFile } from "../lib/mission-parser.js";
import { emitVerifyJson, runVerifyBreakGlass, runVerifyPhasesFromEngine } from "../lib/verify-flow.js";
import { runVerifyWithFix } from "../lib/verify-repair.js";
import type { VerifyOptions } from "../lib/verify-types.js";
import {
  buildVerifyResultPayload,
  buildVerifyResultPayloadFromOptions,
  initFailurePayload,
  type VerifyPassedPayload,
} from "../lib/verify-result-payload.js";
import { evaluateVerifyPhases } from "../lib/verify-engine.js";
import { loadWorkspace } from "../lib/workspace.js";
import { reportUserFacingError } from "../lib/user-error.js";

export type { VerifyOptions } from "../lib/verify-types.js";

function runVerifyBreakGlassJson(
  root: string,
  mission: ReturnType<typeof parseMissionFile>,
  options: VerifyOptions,
): void {
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
    const payload: VerifyPassedPayload = {
      status: "passed",
      phase: "break_glass",
      exit_code: 0,
      msn_id: mission.msnId ?? undefined,
      mission_file_path: missionRel,
      message: reason,
      audit_commit: commitSha,
    };
    emitVerifyJson(payload);
  } catch (e) {
    emitVerifyJson(initFailurePayload(e));
  }
}

export async function runVerify(options: VerifyOptions): Promise<void> {
  if (options.json === true) {
    if (options.breakGlass === true) {
      try {
        const { root } = loadWorkspace();
        const mission = parseMissionFile(root, options.mission);
        runVerifyBreakGlassJson(root, mission, options);
      } catch (e) {
        emitVerifyJson(initFailurePayload(e));
      }
      return;
    }

    const fixOptions: VerifyOptions =
      options.fix === true ? { ...options, fixNonInteractive: true } : options;
    if (fixOptions.fix === true) {
      await runVerifyWithFixJson(fixOptions);
      return;
    }

    emitVerifyJson(buildVerifyResultPayloadFromOptions(options));
    return;
  }

  try {
    const { root } = loadWorkspace();
    const mission = parseMissionFile(root, options.mission);
    const missionArg = options.mission;

    if (options.breakGlass === true) {
      runVerifyBreakGlass(root, mission, options);
      return;
    }

    assertMissionGatePresent(mission);

    if (options.fix === true) {
      await runVerifyWithFix(root, mission, missionArg, options);
      return;
    }

    runVerifyPhasesFromEngine(root, mission, missionArg, options);
  } catch (e) {
    reportUserFacingError(e);
  }
}

async function runVerifyWithFixJson(options: VerifyOptions): Promise<void> {
  try {
    const { root, manifest } = loadWorkspace();
    const mission = parseMissionFile(root, options.mission);
    assertMissionGatePresent(mission);
    emitVerifyJson(buildVerifyResultPayload(root, manifest, mission, options.mission, options));
  } catch (e) {
    emitVerifyJson(initFailurePayload(e));
  }
}

/** Exposed for tests that need silent phase evaluation without fix wrapper. */
export function evaluateVerifyForMission(options: VerifyOptions) {
  const { root, manifest } = loadWorkspace();
  const mission = parseMissionFile(root, options.mission);
  return evaluateVerifyPhases(root, mission, options, manifest);
}
