import { assertMissionGatePresent, parseMissionFile } from "../lib/mission-parser.js";
import { runVerifyBreakGlass, runVerifyPhasesFromEngine } from "../lib/verify-flow.js";
import { runVerifyWithFix } from "../lib/verify-repair.js";
import type { VerifyOptions } from "../lib/verify-types.js";
import { evaluateVerifyPhases } from "../lib/verify-engine.js";
import { loadWorkspace } from "../lib/workspace.js";
import { reportUserFacingError } from "../lib/user-error.js";

export type { VerifyOptions } from "../lib/verify-types.js";

export async function runVerify(options: VerifyOptions): Promise<void> {
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

/** Exposed for tests that need silent phase evaluation without fix wrapper. */
export function evaluateVerifyForMission(options: VerifyOptions) {
  const { root } = loadWorkspace();
  const mission = parseMissionFile(root, options.mission);
  return evaluateVerifyPhases(root, mission, options);
}
