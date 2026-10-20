import { EXIT_CODE } from "#core/exit-codes.js";
import { CLI_NAME } from "#core/constants.js";
import { logError, logInfo, logWarn, setExitCode } from "../lib/cli-io.js";
import { loadWorkspaceWithSkillSync } from "../lib/workspace.js";

export function runCheck(): void {
  const { skillSync } = loadWorkspaceWithSkillSync();
  for (const w of skillSync.warnings) logWarn(w);
  if (!skillSync.ok) {
    for (const e of skillSync.errors) logError(e);
    setExitCode(EXIT_CODE.FAILURE);
    return;
  }
  logInfo(`${CLI_NAME} check: MANIFEST OK; skills/ in sync (Rule 4.4)`);
}
