import type { ResolvedMissionArg } from "./mission-arg.js";
import type { Manifest, ParsedMission } from "./types.js";
import type { VerifyOptions } from "./verify-options.js";
import { CLI_NAME } from "./constants.js";
import { runBreakGlassAuditFlow } from "./break-glass.js";
import { errorMessage, logInfo, logWarn } from "./cli-io.js";
import { CommandReporter } from "./command-reporter.js";
import { logFixHint } from "./fix-hints.js";
import { loadPrompts } from "./prompts-loader.js";
import { isGantryUserError } from "./errors.js";
import { appendSurgeonMutationLog } from "./surgeon.js";
import { evaluateVerifyPhases, type VerifyPhaseResult } from "./verify-engine.js";
import type { VerifyPhaseFailure } from "./verify-failure.js";
import { buildVerifyExportDocument, type VerifyExportFormat } from "./verify-export.js";
import {
  buildFindingsForFailure,
  buildVerifyResultPayloadFromPhaseResult,
  buildBreakGlassPayload,
  initFailurePayload,
  toVerifyFailedPayload,
  type VerifyResultPayload,
} from "./verify-payload.js";
import { hintsForVerifyPhase } from "./verify-hints.js";
import {
  normalizeVerifyPhaseFailure,
  toFailurePresentation,
  type VerifyFailurePresentation,
} from "./verify-failure-normalize.js";
import {
  getSurgeonForErrorCode,
  resolveSurgeonErrorCode,
  type SurgeonContext,
} from "./surgeons/registry.js";
import { persistRemediationFromFailedPayload } from "./context-feed-remediation.js";
import {
  persistFailedVerifyRemediation,
  tombstoneRemediationSnapshot,
} from "./verify-remediation-pipeline.js";
import { readRemediationSnapshot } from "./context-feed-store.js";
import type { GxtErrorCode } from "./gxt-error-codes.js";

/** Shared verify orchestration context (load once, present by sink). */
export interface VerifyPresentContext {
  root: string;
  manifest: Manifest;
  mission: ParsedMission;
  /** Flag vs pin resolution — single source for mission_source in payloads. */
  resolved: ResolvedMissionArg;
  options: VerifyOptions;
  /** Set after tryWriteReceiptIfRequested when --receipt was requested. */
  receiptPath?: string;
}

export type VerifySink =
  | "break_glass_json"
  | "break_glass_human"
  | "json"
  | "fix_interactive"
  | "fix_noninteractive"
  | "human";

/** Structured export format for verify output (json default when --json). */
export function resolveVerifyExportFormat(options: { format?: VerifyExportFormat; json?: boolean }): VerifyExportFormat | undefined {
  if (options.format) return options.format;
  if (options.json === true) return "json";
  return undefined;
}

export function resolveVerifySink(options: {
  breakGlass?: boolean;
  format?: VerifyExportFormat;
  json?: boolean;
  fix?: boolean;
  fixNonInteractive?: boolean;
}): VerifySink {
  if (options.breakGlass === true) {
    return options.json || options.format ? "break_glass_json" : "break_glass_human";
  }
  if (resolveVerifyExportFormat(options)) return "json";
  if (options.fix === true) {
    return options.fixNonInteractive ? "fix_noninteractive" : "fix_interactive";
  }
  return "human";
}

export interface VerifyPresentResult {
  ok: boolean;
  exitCode: number;
}

function reporterFor(ctx: VerifyPresentContext): CommandReporter {
  return CommandReporter.forVerify(ctx.options);
}

function overlayFailurePresentation(
  base: VerifyFailurePresentation,
  overlay: { error_code: GxtErrorCode; fix_hints: string[]; next_actions: string[] },
): VerifyFailurePresentation {
  return {
    ...base,
    error_code: overlay.error_code,
    fix_hints: overlay.fix_hints,
    next_actions: overlay.next_actions,
  };
}

function presentationFromPersistedSnapshot(
  root: string,
  msnId: string | undefined,
  base: VerifyFailurePresentation,
): VerifyFailurePresentation {
  const snapshot = readRemediationSnapshot(root);
  if (!snapshot || (msnId !== undefined && snapshot.msn_id !== msnId)) {
    return base;
  }
  return overlayFailurePresentation(base, {
    error_code: snapshot.error_code as GxtErrorCode,
    fix_hints: snapshot.fix_hints,
    next_actions: snapshot.next_actions,
  });
}

export function presentBreakGlassJson(ctx: VerifyPresentContext): VerifyPresentResult {
  const payload = buildBreakGlassPayload(ctx.root, ctx.mission, ctx.options);
  emitStructuredPayload(payload, ctx.options);
  return { ok: payload.exit_code === 0, exitCode: payload.exit_code };
}

export function presentBreakGlassHuman(ctx: VerifyPresentContext): VerifyPresentResult {
  const reporter = reporterFor(ctx);
  const outcome = runBreakGlassAuditFlow(ctx.root, ctx.mission, ctx.options);
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

function emitStructuredPayload(payload: VerifyResultPayload, options: VerifyPresentContext["options"]): void {
  const format: VerifyExportFormat = resolveVerifyExportFormat(options) ?? "json";
  logInfo(buildVerifyExportDocument(payload, format));
}

/** Attach resolved mission + receipt path from the loaded verify context. */
function withContextFields<T extends VerifyResultPayload>(
  payload: T,
  ctx: VerifyPresentContext,
): T {
  return {
    ...payload,
    mission_file_path: ctx.resolved.missionRel,
    mission_source: ctx.resolved.source,
    ...(ctx.receiptPath ? { receipt_path: ctx.receiptPath } : {}),
  };
}

export function presentJsonFromResult(
  ctx: VerifyPresentContext,
  result: VerifyPhaseResult,
): VerifyPresentResult {
  const payload = withContextFields(
    buildVerifyResultPayloadFromPhaseResult(ctx.root, ctx.mission, ctx.options, result),
    ctx,
  );
  emitStructuredPayload(payload, ctx.options);
  return { ok: payload.exit_code === 0, exitCode: payload.exit_code };
}

export function presentJsonInitFailure(
  ctx: VerifyPresentContext,
  error: unknown,
): VerifyPresentResult {
  const payload = withContextFields(initFailurePayload(error), ctx);
  try {
    persistRemediationFromFailedPayload(ctx.root, null, ctx.options.mission, payload);
  } catch {
    // best-effort remediation feed
  }
  emitStructuredPayload(payload, ctx.options);
  return { ok: false, exitCode: payload.exit_code };
}

export function presentHumanInitFailure(
  ctx: VerifyPresentContext,
  error: unknown,
): VerifyPresentResult {
  const reporter = reporterFor(ctx);
  const payload = withContextFields(initFailurePayload(error), ctx);
  try {
    persistRemediationFromFailedPayload(ctx.root, null, ctx.options.mission, payload);
  } catch {
    // best-effort remediation feed
  }
  if (isGantryUserError(error)) {
    reporter.emitError(`[${error.gxtCode}] ${error.message}`);
    if (error.hint) reporter.emitFixHint(error.hint);
    return { ok: false, exitCode: error.exitCode };
  }
  reporter.emitError(errorMessage(error));
  return { ok: false, exitCode: payload.exit_code };
}

export function presentHuman(
  ctx: VerifyPresentContext,
  result: VerifyPhaseResult,
): VerifyPresentResult {
  const reporter = reporterFor(ctx);
  if (result.ok) {
    tombstoneRemediationSnapshot(ctx.root);
    reporter.emitVerifySuccess(result, ctx.resolved.missionRel);
    if (ctx.receiptPath) reporter.emitInfo(`${CLI_NAME} verify: wrote ${ctx.receiptPath}`);
    return { ok: true, exitCode: 0 };
  }
  if (ctx.receiptPath) reporter.emitInfo(`${CLI_NAME} verify: wrote ${ctx.receiptPath}`);
  const normalized = normalizeVerifyPhaseFailure({
    failure: result,
    missionArg: ctx.resolved.missionRel,
    options: ctx.options,
    root: ctx.root,
    msnId: ctx.mission.msnId ?? undefined,
    mission: ctx.mission,
  });
  const basePresentation = toFailurePresentation(normalized);
  const msnId = ctx.mission.msnId ?? undefined;
  let presentation = basePresentation;

  if (ctx.options.fix === true) {
    presentation = presentationFromPersistedSnapshot(ctx.root, msnId, basePresentation);
  } else {
    const failure = result as VerifyPhaseFailure;
    const findings = buildFindingsForFailure(ctx.root, normalized, failure);
    const persisted = persistFailedVerifyRemediation(
      ctx.root,
      ctx.mission,
      ctx.resolved.missionRel,
      toVerifyFailedPayload(normalized, failure, findings),
      findings,
    );
    presentation = overlayFailurePresentation(basePresentation, persisted);
  }

  reporter.emitFailurePresentation(presentation);
  return { ok: false, exitCode: presentation.exit_code };
}

export async function presentFix(
  ctx: VerifyPresentContext,
  result: VerifyPhaseResult,
  nonInteractive: boolean,
): Promise<VerifyPresentResult> {
  if (result.ok || nonInteractive) {
    return presentHuman(ctx, result);
  }

  const failure = result as VerifyPhaseFailure;
  const reporter = reporterFor(ctx);
  const normalized = normalizeVerifyPhaseFailure({
    failure,
    missionArg: ctx.resolved.missionRel,
    options: ctx.options,
    root: ctx.root,
    msnId: ctx.mission.msnId ?? undefined,
    mission: ctx.mission,
  });
  const presentation = presentationFromPersistedSnapshot(
    ctx.root,
    ctx.mission.msnId ?? undefined,
    toFailurePresentation(normalized),
  );
  const remediation = hintsForVerifyPhase(failure, {
    missionPath: ctx.resolved.missionRel,
    root: ctx.root,
    msnId: ctx.mission.msnId ?? undefined,
  });

  reporter.emitError(`[${presentation.error_code}] verify failed at phase: ${failure.phase}`);

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
    reporter.emitNextSteps(presentation.next_actions, remediation.tagged_steps);
    return { ok: false, exitCode: failure.exitCode };
  }

  const idx = Number.parseInt(String(selected), 10);
  const hint = presentation.fix_hints[idx];
  if (hint) reporter.emitFixHint(hint);
  reporter.emitNextSteps(presentation.next_actions, remediation.tagged_steps);
  return { ok: false, exitCode: failure.exitCode };
}

export function emitVerifyJson(payload: VerifyResultPayload, options: VerifyPresentContext["options"]): void {
  CommandReporter.forVerify(options).emitJsonPayload(payload);
}

/** One surgeon mutation pass + phase re-eval only (no nested runVerifyCore). */
export async function maybeApplySurgeonAndReevaluate(input: {
  root: string;
  mission: VerifyPresentContext["mission"];
  options: VerifyPresentContext["options"];
  manifest: VerifyPresentContext["manifest"];
  result: VerifyPhaseResult;
}): Promise<VerifyPhaseResult> {
  if (input.result.ok) return input.result;
  if (input.options.fix !== true) return input.result;

  const failure = input.result as VerifyPhaseFailure;
  if (failure.phase !== "gate") return input.result;

  const errorCode = resolveSurgeonErrorCode(failure);
  if (!errorCode) return input.result;

  const surgeon = getSurgeonForErrorCode(errorCode);
  if (!surgeon) return input.result;

  const executorLogPath = failure.executorLogPath;
  const context: SurgeonContext = {
    root: input.root,
    failure,
    manifest: input.manifest,
    executorLogPath,
    errorCode,
  };

  logWarn(`[Surgeon] Autonomous mutation triggered for error ${errorCode}`);
  const mutation = await surgeon.applyMutation(context);
  if (!mutation.mutated) {
    logInfo(`${CLI_NAME} verify: [Surgeon] no mutation applied (${mutation.summary})`);
    return input.result;
  }

  appendSurgeonMutationLog(executorLogPath, mutation.summary);
  logInfo(`${CLI_NAME} verify: [Surgeon] mutation logged; re-evaluating verify phases (fix disabled)`);

  const reevalOptions: VerifyPresentContext["options"] = {
    ...input.options,
    fix: false,
    fixNonInteractive: false,
    receipt: undefined,
  };
  return evaluateVerifyPhases(input.root, input.mission, reevalOptions, input.manifest);
}
