import { logInfo } from "../output/cli-io.js";
import { runUserCommand } from "../output/command-boundary.js";
import { GantryUserError } from "#core/user-error.js";
import { clearActiveMissionPin, pinActiveMission, readActiveMissionPin } from "#missions/mission/resolution.js";
import { loadWorkspace } from "#missions/workspace.js";

export interface PinOptions {
  mission?: string;
}

export function runPin(options: PinOptions): void {
  runUserCommand({ json: false }, () => {
    const { root } = loadWorkspace();
    const missionArg = options.mission?.trim();

    if (!missionArg) {
      const pinned = readActiveMissionPin(root);
      if (!pinned) {
        throw new GantryUserError(
          "MISSION_REQUIRED",
          "gantry mission pin: no active mission pinned",
          "gantry mission pin .gitagent/missions/<file>.yaml",
          1,
        );
      }
      logInfo(pinned);
      return;
    }

    const rel = pinActiveMission(root, missionArg);
    logInfo(`Pinned active mission: ${rel}`);
  });
}

export function runUnpin(): void {
  runUserCommand({ json: false }, () => {
    const { root } = loadWorkspace();
    if (!clearActiveMissionPin(root)) {
      throw new GantryUserError(
        "MISSION_REQUIRED",
        "gantry mission unpin: no active mission pinned",
        undefined,
        1,
      );
    }
    logInfo("gantry mission unpin: cleared active mission pin");
  });
}
