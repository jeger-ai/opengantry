import { logInfo } from "../lib/cli-io.js";
import { runUserCommand } from "../lib/command-boundary.js";
import { GantryUserError } from "../lib/errors.js";
import {
  clearActiveMissionPin,
  pinActiveMission,
  readActiveMissionPin,
} from "../lib/missions/parser.js";
import { loadWorkspace } from "../lib/workspace.js";

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
          "gantry pin: no active mission pinned",
          "gantry pin .gitagent/missions/<file>.yaml",
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
        "gantry unpin: no active mission pinned",
        undefined,
        1,
      );
    }
    logInfo("gantry unpin: cleared active mission pin");
  });
}
