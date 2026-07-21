import { logInfo, setExitCode } from "../lib/cli-io.js";
import { attestMission } from "../lib/attest-mission.js";
import { GantryUserError, reportUserFacingError } from "../lib/errors.js";

export interface AttestOptions {
  mission: string;
  out?: string;
  sign?: boolean;
  json?: boolean;
}

export function runAttest(options: AttestOptions): void {
  try {
    const result = attestMission(options);
    if (options.json) {
      logInfo(JSON.stringify(result, null, 2));
    } else {
      logInfo(`gantry attest: wrote ${result.receipt_path}`);
    }
  } catch (e) {
    reportUserFacingError(e);
    setExitCode(e instanceof GantryUserError ? e.exitCode : 2);
  }
}
