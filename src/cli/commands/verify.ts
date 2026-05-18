import { assertMissionGatePresent, parseMissionFile } from "../lib/mission-parser.js";
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
  const { root } = loadWorkspace();
  const mission = parseMissionFile(root, options.mission);
  assertMissionGatePresent(mission);
  const missionArg = options.mission;

  if (options.breakGlass === true) {
    runVerifyBreakGlass(root, mission, options);
    return;
  }

  if (runVerifyGitProof(root, mission) === null) return;
  if (!runVerifyGate(root, mission, missionArg, options)) return;
  runVerifyTrace(root, mission, missionArg, options);
}
