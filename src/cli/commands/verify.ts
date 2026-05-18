import { assertMissionGatePresent, parseMissionFile } from "../lib/mission-parser.js";
import { reportUserFacingError } from "../lib/user-error.js";
import {
  runVerifyBreakGlass,
  runVerifyGate,
  runVerifyGitProof,
  runVerifyTrace,
} from "../lib/verify-flow.js";
import type { VerifyOptions } from "../lib/verify-types.js";
import { loadWorkspace } from "../lib/workspace.js";

export type { VerifyOptions } from "../lib/verify-types.js";

export function runVerify(options: VerifyOptions): void {
  try {
    runVerifyInner(options);
  } catch (e) {
    reportUserFacingError(e);
  }
}

function runVerifyInner(options: VerifyOptions): void {
  const { root } = loadWorkspace();
  const mission = parseMissionFile(root, options.mission);
  const missionArg = options.mission;

  if (options.breakGlass === true) {
    runVerifyBreakGlass(root, mission, options);
    return;
  }

  assertMissionGatePresent(mission);
  if (runVerifyGitProof(root, mission) === null) return;
  if (!runVerifyGate(root, mission, missionArg, options)) return;
  runVerifyTrace(root, mission, missionArg, options);
}
