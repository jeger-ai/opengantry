import { logInfo } from "../lib/cli-io.js";
import { attestMission } from "../lib/attest-mission.js";
import { emitCliJson, runUserCommand } from "../lib/command-boundary.js";
import { emitPinnedMissionBanner, resolveMissionArg } from "../lib/mission-arg.js";
import { loadWorkspace } from "../lib/workspace.js";

export interface AttestOptions {
  mission?: string;
  out?: string;
  exportPath?: string;
  sign?: boolean;
  json?: boolean;
}

export function runAttest(options: AttestOptions): void {
  runUserCommand({ json: options.json }, () => {
    const { root } = loadWorkspace();
    const resolved = resolveMissionArg(root, options.mission);
    emitPinnedMissionBanner(resolved, { json: options.json });
    const result = attestMission({ root, resolved, out: options.out, exportPath: options.exportPath, sign: options.sign });
    if (options.json) {
      emitCliJson({
        status: "ok",
        ...result,
        ...(result.export_path ? { export_path: result.export_path } : {}),
      });
    } else {
      logInfo(`gantry attest: wrote ${result.receipt_path}`);
      if (result.export_path) {
        logInfo(`gantry attest: export ${result.export_path}`);
      }
    }
  });
}
