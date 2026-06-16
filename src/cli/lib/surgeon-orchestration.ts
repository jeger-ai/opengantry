import { CLI_NAME } from "./constants.js";
import { logInfo, logWarn } from "./cli-io.js";
import { appendSurgeonMutationLog } from "./surgeon-mutation-log.js";
import type { Manifest, ParsedMission } from "./types.js";
import type { VerifyPhaseFailure } from "./verify-engine.js";
import {
  getSurgeonForErrorCode,
  resolveSurgeonErrorCode,
  type SurgeonContext,
} from "./surgeons/registry.js";
import { runVerifyCore, type VerifyRunResult } from "./verify-run.js";
import type { VerifyOptions } from "./verify-types.js";

export interface SurgeonOrchestrationInput {
  root: string;
  mission: ParsedMission;
  missionArg: string;
  options: VerifyOptions;
  manifest: Manifest;
  failure: VerifyPhaseFailure;
}

/** Attempt surgeon mutation; on success rerun full verify with fix disabled (no auto-pass). */
export async function trySurgeonAndRerunVerify(
  input: SurgeonOrchestrationInput,
): Promise<VerifyRunResult | null> {
  if (input.options.fix !== true) return null;

  const errorCode = resolveSurgeonErrorCode(input.failure);
  if (!errorCode) return null;

  const surgeon = getSurgeonForErrorCode(errorCode);
  if (!surgeon) return null;

  const workerLogPath = input.failure.workerLogPath;
  const context: SurgeonContext = {
    root: input.root,
    failure: input.failure,
    manifest: input.manifest,
    workerLogPath,
    errorCode,
  };

  logWarn(`[Surgeon] Autonomous mutation triggered for error ${errorCode}`);
  const mutation = await surgeon.applyMutation(context);
  if (!mutation.mutated) {
    logInfo(`${CLI_NAME} verify: [Surgeon] no mutation applied (${mutation.summary})`);
    return null;
  }

  appendSurgeonMutationLog(workerLogPath, mutation.summary);
  logInfo(`${CLI_NAME} verify: [Surgeon] mutation logged; rerunning full verify (fix disabled)`);

  return runVerifyCore({
    ...input.options,
    fix: false,
    fixNonInteractive: false,
  });
}
