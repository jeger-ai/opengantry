import { assertMissionGatePresent, parseMissionFile } from "../lib/mission-parser.js";
import { emitVerifyJson, runVerifyBreakGlass, runVerifyPhasesFromEngine } from "../lib/verify-flow.js";
import { runVerifyWithFix } from "../lib/verify-repair.js";
import type { VerifyOptions } from "../lib/verify-types.js";
import {
  buildBreakGlassPayload,
  buildVerifyResultPayload,
  initFailurePayload,
} from "../lib/verify-result-payload.js";
import { evaluateVerifyPhases } from "../lib/verify-engine.js";
import { loadWorkspace } from "../lib/workspace.js";
import { GapmanUserError, reportUserFacingError } from "../lib/user-error.js";

export type { VerifyOptions } from "../lib/verify-types.js";

function assertVerifyOptionsCompatible(options: VerifyOptions): void {
  if (options.json === true && options.fix === true) {
    throw new GapmanUserError(
      "INVALID_ARGUMENT",
      "The --fix flag cannot be used with --json. Automated repair is not supported in structured output mode.",
      undefined,
      2,
    );
  }
}

export async function runVerify(options: VerifyOptions): Promise<void> {
  try {
    assertVerifyOptionsCompatible(options);
  } catch (e) {
    if (options.json) {
      emitVerifyJson(initFailurePayload(e));
      return;
    }
    reportUserFacingError(e);
    return;
  }

  try {
    const { root, manifest } = loadWorkspace();
    const mission = parseMissionFile(root, options.mission);
    const missionArg = options.mission;

    if (options.breakGlass === true) {
      if (options.json) {
        emitVerifyJson(buildBreakGlassPayload(root, mission, options));
      } else {
        runVerifyBreakGlass(root, mission, options);
      }
      return;
    }

    if (options.json) {
      try {
        assertMissionGatePresent(mission);
        emitVerifyJson(buildVerifyResultPayload(root, manifest, mission, missionArg, options));
      } catch (e) {
        emitVerifyJson(initFailurePayload(e));
      }
      return;
    }

    assertMissionGatePresent(mission);

    if (options.fix === true) {
      await runVerifyWithFix(root, mission, missionArg, options, manifest);
      return;
    }

    runVerifyPhasesFromEngine(root, mission, missionArg, options, manifest);
  } catch (e) {
    if (options.json) {
      emitVerifyJson(initFailurePayload(e));
      return;
    }
    reportUserFacingError(e);
  }
}

/** Exposed for tests that need silent phase evaluation without fix wrapper. */
export function evaluateVerifyForMission(options: VerifyOptions) {
  const { root, manifest } = loadWorkspace();
  const mission = parseMissionFile(root, options.mission);
  return evaluateVerifyPhases(root, mission, options, manifest);
}
