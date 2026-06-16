import { CLI_NAME } from "./constants.js";
import { runBreakGlassAuditFlow } from "./break-glass-flow.js";
import { errorMessage } from "./cli-io.js";
import { CommandReporter } from "./command-reporter.js";
import { logFixHint } from "./fix-hints.js";
import { loadPrompts } from "./prompts-loader.js";
import type { Manifest, ParsedMission } from "./types.js";
import { isGapmanUserError } from "./user-error.js";
import {
  type VerifyPhaseFailure,
  type VerifyPhaseResult,
} from "./verify-engine.js";
import { verifyFailurePresentation } from "./verify-failure-presentation.js";
import { trySurgeonAndRerunVerify } from "./surgeon-orchestration.js";
import {
  buildBreakGlassPayload,
  buildVerifyResultPayloadFromPhaseResult,
  initFailurePayload,
  type VerifyResultPayload,
} from "./verify-result-payload.js";
import { hintsForVerifyPhase, buildVerifyHintContext } from "./verify-remediation.js";
import type { VerifyOptions } from "./verify-types.js";

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

/** Emit structured JSON without re-evaluating phases (tests / init errors). */
export function emitVerifyJson(payload: VerifyResultPayload, options: VerifyOptions): void {
  reporterFor(options).emitJsonPayload(payload);
}
