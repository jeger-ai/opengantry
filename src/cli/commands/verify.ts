import { setExitCode } from "../lib/cli-io.js";
import { parseMissionFile } from "../lib/mission-parser.js";
import { initFailurePayload } from "../lib/verify-result-payload.js";
import { emitVerifyJson } from "../lib/verify-present.js";
import type { VerifyOptions } from "../lib/verify-types.js";
import { evaluateVerifyPhases } from "../lib/verify-engine.js";
import { loadWorkspace } from "../lib/workspace.js";
import { GapmanUserError, reportUserFacingError } from "../lib/user-error.js";
import { runVerifyCore } from "../lib/verify-run.js";

export type { VerifyOptions } from "../lib/verify-types.js";

function assertVerifyOptionsCompatible(options: VerifyOptions): void {
  if (options.json === true && options.fix === true) {
    throw new GapmanUserError(
      "INVALID_ARGUMENT",
      "The --fix flag cannot be used with --json. Automated repair is not supported in structured output mode.",
      undefined,
      2,
    );
  }
}

export async function runVerify(options: VerifyOptions): Promise<void> {
  try {
    assertVerifyOptionsCompatible(options);
  } catch (e) {
    if (options.json) {
      const payload = initFailurePayload(e);
      emitVerifyJson(payload, options);
      setExitCode(payload.exit_code);
      return;
    }
    reportUserFacingError(e);
    return;
  }

  try {
    const result = await runVerifyCore(options);
    if (!result.ok) {
      setExitCode(result.exitCode);
    }
  } catch (e) {
    if (options.json) {
      const payload = initFailurePayload(e);
      emitVerifyJson(payload, options);
      setExitCode(payload.exit_code);
      return;
    }
    reportUserFacingError(e);
  }
}

/** Exposed for tests that need silent phase evaluation without fix wrapper. */
export function evaluateVerifyForMission(options: VerifyOptions) {
  const { root, manifest } = loadWorkspace();
  const mission = parseMissionFile(root, options.mission);
  return evaluateVerifyPhases(root, mission, options, manifest);
}
