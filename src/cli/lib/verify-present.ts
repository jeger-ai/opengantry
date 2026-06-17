import { CLI_NAME } from "./constants.js";
import { runBreakGlassAuditFlow } from "./break-glass.js";
import { errorMessage, logInfo, logWarn } from "./cli-io.js";
import { CommandReporter } from "./command-reporter.js";
import { logFixHint } from "./fix-hints.js";
import { assertMissionGatePresent, parseMissionFile } from "./missions/parser.js";
import { loadPrompts } from "./prompts-loader.js";
import type { Manifest, ParsedMission } from "./types.js";
import { isGapmanUserError } from "./errors.js";
import { appendSurgeonMutationLog } from "./surgeon.js";
import { loadWorkspace } from "./workspace.js";
import {
  evaluateVerifyPhases,
  type VerifyOptions,
  type VerifyPhaseFailure,
  type VerifyPhaseResult,
} from "./verify-engine.js";
import {
  buildBreakGlassPayload,
  buildVerifyResultPayloadFromPhaseResult,
  initFailurePayload,
  type VerifyResultPayload,
} from "./verify-payload.js";
import {
  buildVerifyHintContext,
  hintsForVerifyPhase,
  verifyFailurePresentation,
} from "./verify-remediation.js";
import {
  getSurgeonForErrorCode,
  resolveSurgeonErrorCode,
  type SurgeonContext,
} from "./surgeons/registry.js";

export interface VerifyRunResult {
  ok: boolean;
  exitCode: number;
}

export interface VerifyPresentResult {
  ok: boolean;
  exitCode: number;
}

export type VerifySink =
  | "break_glass_json"
  | "break_glass_human"
  | "json"
  | "fix_interactive"
  | "fix_noninteractive"
  | "human";

async function trySurgeonAndRerunVerify(
  input: {
    root: string;
    mission: ParsedMission;
    missionArg: string;
    options: VerifyOptions;
    manifest: Manifest;
    failure: VerifyPhaseFailure;
  },
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

export function resolveVerifySink(options: VerifyOptions): VerifySink {
  if (options.breakGlass === true) {
    return options.json ? "break_glass_json" : "break_glass_human";
  }
  if (options.json) return "json";
  if (options.fix === true) {
    return options.fixNonInteractive ? "fix_noninteractive" : "fix_interactive";
  }
  return "human";
}

function reporterFor(options: VerifyOptions): CommandReporter {
  return CommandReporter.forVerify(options);
}

export function presentBreakGlassJson(
  root: string,
  mission: ParsedMission,
  options: VerifyOptions,
): VerifyPresentResult {
  const payload = buildBreakGlassPayload(root, mission, options);
  reporterFor(options).emitJsonPayload(payload);
  return { ok: payload.exit_code === 0, exitCode: payload.exit_code };
}

export function presentBreakGlassHuman(
  root: string,
  mission: ParsedMission,
  options: VerifyOptions,
): VerifyPresentResult {
  const reporter = reporterFor(options);
  const outcome = runBreakGlassAuditFlow(root, mission, options);
  if (outcome.kind === "fail") {
    reporter.emitError(errorMessage(outcome.error));
    return { ok: false, exitCode: 2 };
  }
  reporter.emitInfo(`${CLI_NAME} verify: BREAK-GLASS — all gates skipped (audited on ${outcome.commitSha})`);
  reporter.emitInfo(`  reason: ${outcome.reason}`);
  if (outcome.msnId) reporter.emitInfo(`  msn_id: ${outcome.msnId}`);
  if (outcome.auditCommit) {
    logFixHint("git push origin HEAD  # audit empty commit (no gxt-bypass note)");
  } else {
    logFixHint("git push origin refs/notes/gxt-bypass");
  }
  return { ok: true, exitCode: 0 };
}

export function presentJsonFromResult(
  root: string,
  mission: ParsedMission,
  missionArg: string,
  options: VerifyOptions,
  manifest: Manifest,
  result: VerifyPhaseResult,
): VerifyPresentResult {
  const payload = buildVerifyResultPayloadFromPhaseResult(
    root,
    mission,
    missionArg,
    options,
    manifest,
    result,
  );
  reporterFor(options).emitJsonPayload(payload);
  return { ok: payload.exit_code === 0, exitCode: payload.exit_code };
}

export function presentJsonInitFailure(
  options: VerifyOptions,
  error: unknown,
): VerifyPresentResult {
  const payload = initFailurePayload(error);
  reporterFor(options).emitJsonPayload(payload);
  return { ok: false, exitCode: payload.exit_code };
}

export function presentHumanInitFailure(
  options: VerifyOptions,
  error: unknown,
): VerifyPresentResult {
  const reporter = reporterFor(options);
  if (isGapmanUserError(error)) {
    reporter.emitError(`[${error.gxtCode}] ${error.message}`);
    if (error.hint) reporter.emitFixHint(error.hint);
    return { ok: false, exitCode: error.exitCode };
  }
  reporter.emitError(errorMessage(error));
  return { ok: false, exitCode: 1 };
}

export function presentHuman(
  root: string,
  mission: ParsedMission,
  missionArg: string,
  options: VerifyOptions,
  result: VerifyPhaseResult,
): VerifyPresentResult {
  const reporter = reporterFor(options);
  if (result.ok) {
    reporter.emitVerifySuccess(result, missionArg);
    return { ok: true, exitCode: 0 };
  }
  const presentation = verifyFailurePresentation({
    failure: result,
    missionArg,
    options,
    root,
    msnId: mission.msnId ?? undefined,
  });
  reporter.emitFailurePresentation(presentation);
  return { ok: false, exitCode: presentation.exit_code };
}

export async function presentFix(
  root: string,
  mission: ParsedMission,
  missionArg: string,
  options: VerifyOptions,
  result: VerifyPhaseResult,
  nonInteractive: boolean,
  manifest: Manifest,
): Promise<VerifyPresentResult> {
  if (result.ok) {
    return presentHuman(root, mission, missionArg, options, result);
  }

  const failure = result as VerifyPhaseFailure;
  const surgeonRerun = await trySurgeonAndRerunVerify({
    root,
    mission,
    missionArg,
    options,
    manifest,
    failure,
  });
  if (surgeonRerun) {
    return surgeonRerun;
  }

  if (nonInteractive) {
    return presentHuman(root, mission, missionArg, options, result);
  }

  const reporter = reporterFor(options);
  const remediation = hintsForVerifyPhase(
    failure.phase,
    buildVerifyHintContext(failure, missionArg, options, root, mission.msnId ?? undefined),
  );

  reporter.emitError(`[${remediation.error_code}] verify failed at phase: ${failure.phase}`);

  const p = await loadPrompts();
  const choices = remediation.fix_hints.map((hint, i) => ({
    value: String(i),
    label: hint.length > 100 ? `${hint.slice(0, 97)}…` : hint,
    hint,
  }));
  choices.push({ value: "quit", label: "Exit (fix manually)", hint: "" });

  const selected = await p.select({
    message: "Choose a remediation step",
    options: choices,
  });

  if (p.isCancel(selected) || selected === "quit") {
    reporter.emitNextSteps(remediation.next_actions, remediation.tagged_steps);
    return { ok: false, exitCode: failure.exitCode };
  }

  const idx = Number.parseInt(String(selected), 10);
  const hint = remediation.fix_hints[idx];
  if (hint) reporter.emitFixHint(hint);
  reporter.emitNextSteps(remediation.next_actions, remediation.tagged_steps);
  return { ok: false, exitCode: failure.exitCode };
}

export function emitVerifyJson(payload: VerifyResultPayload, options: VerifyOptions): void {
  reporterFor(options).emitJsonPayload(payload);
}

/** Unified verify orchestration: load workspace once, evaluate once, present by sink. */
export async function runVerifyCore(options: VerifyOptions): Promise<VerifyRunResult> {
  const { root, manifest } = loadWorkspace();
  if (!options.mission) {
    throw new Error("gapman verify: --mission is required");
  }
  const mission = parseMissionFile(root, options.mission);
  const missionArg = options.mission;
  const sink = resolveVerifySink(options);

  switch (sink) {
    case "break_glass_json":
      return presentBreakGlassJson(root, mission, options);
    case "break_glass_human":
      return presentBreakGlassHuman(root, mission, options);
    case "json": {
      try {
        assertMissionGatePresent(mission);
        const result = evaluateVerifyPhases(root, mission, options, manifest);
        return presentJsonFromResult(root, mission, missionArg, options, manifest, result);
      } catch (e) {
        return presentJsonInitFailure(options, e);
      }
    }
    case "fix_interactive":
    case "fix_noninteractive":
    case "human": {
      try {
        assertMissionGatePresent(mission);
      } catch (e) {
        return presentHumanInitFailure(options, e);
      }
      const result = evaluateVerifyPhases(root, mission, options, manifest);
      if (sink === "fix_interactive") {
        return presentFix(root, mission, missionArg, options, result, false, manifest);
      }
      if (sink === "fix_noninteractive") {
        return presentFix(root, mission, missionArg, options, result, true, manifest);
      }
      return presentHuman(root, mission, missionArg, options, result);
    }
    default: {
      const _exhaustive: never = sink;
      return _exhaustive;
    }
  }
}
