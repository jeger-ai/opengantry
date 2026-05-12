import { CLI_NAME } from "../lib/constants.js";
import { formatRepoRelative, logError, logInfo, setExitCode } from "../lib/cli-io.js";
import { isValidMsnId } from "../lib/msn.js";
import { assertMissionGatePresent, parseMissionFile } from "../lib/mission-parser.js";
import { captureStartState, writeSnapshot } from "../lib/start-state.js";
import { loadWorkspace } from "../lib/workspace.js";

export function runMissionValidate(file: string): void {
  const { root } = loadWorkspace();
  const mission = parseMissionFile(root, file);
  assertMissionGatePresent(mission);
  logInfo(`${CLI_NAME} mission validate: OK (${mission.rawPath})`);
  if (mission.gate) logInfo(`  gate: ${mission.gate.command}`);
}

export function runMissionSnapshot(file: string, msnOverride?: string): void {
  const { root, manifest } = loadWorkspace();
  const mission = parseMissionFile(root, file);
  assertMissionGatePresent(mission);
  const msn = msnOverride ?? mission.msnId;
  if (!msn || !isValidMsnId(msn)) {
    logError("mission snapshot: need MSN-NNNN in mission or pass --msn");
    setExitCode(1);
    return;
  }
  const snapshot = captureStartState(root, manifest, mission.skillKey);
  const outputPath = writeSnapshot(root, snapshot, msn);
  logInfo(`${CLI_NAME} mission snapshot: wrote ${formatRepoRelative(root, outputPath)}`);
}
