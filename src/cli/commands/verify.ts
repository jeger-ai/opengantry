import { assertMissionGatePresent, parseMissionFile } from "../lib/mission-parser.js";
import { isLegislativeStub } from "../lib/mission-legislative-stub.js";
import { CLI_NAME } from "../lib/constants.js";
import { logError, logInfo, setExitCode } from "../lib/cli-io.js";
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

  if (options.prePush === true && isLegislativeStub(mission)) {
    logInfo(
      `${CLI_NAME} verify: legislative stub OK (remote handoff; git-proof passed — run full verify after execution)`,
    );
    return;
  }

  if (!runVerifyGate(root, mission, missionArg, options)) return;

  const hasPendingRows = mission.traceRows.some((row) =>
    row.status.toUpperCase().includes("PENDING"),
  );
  if (hasPendingRows) {
    logError(
      `${CLI_NAME} verify: trace rows still PENDING — worker must execute, append WORKER_LOG evidence, and set PASS before full verify`,
    );
    setExitCode(1);
    return;
  }

  runVerifyTrace(root, mission, missionArg, options);
}
