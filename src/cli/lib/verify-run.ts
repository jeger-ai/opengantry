import { assertMissionGatePresent, parseMissionFile } from "./missions/parser.js";
import { emitPinnedMissionBanner, resolveMissionArg } from "./mission-arg.js";
import { loadWorkspace } from "./workspace.js";
import { evaluateVerifyPhases, type VerifyPhaseResult } from "./verify-engine.js";
import type { VerifyOptions } from "./verify-options.js";
import {
  buildVerifyResultPayload,
  initFailurePayload,
  type VerifyResultPayload,
} from "./verify-payload.js";
import type { VerifyPresentContext } from "./verify-context.js";
import {
  resolveVerifySink,
  maybeApplySurgeonAndReevaluate,
  presentBreakGlassHuman,
  presentBreakGlassJson,
  presentFix,
  presentHuman,
  presentHumanInitFailure,
  presentJsonFromResult,
  presentJsonInitFailure,
} from "./verify-presenters.js";
import { maybeWriteVerifyReceipt } from "./verify-receipt.js";

export type { VerifyPresentContext } from "./verify-context.js";

export interface VerifyRunResult {
  ok: boolean;
  exitCode: number;
}

function loadVerifyContext(options: VerifyOptions): VerifyPresentContext {
  const { root, manifest } = loadWorkspace();
  const resolved = resolveMissionArg(root, options.mission);
  return {
    root,
    manifest,
    mission: parseMissionFile(root, resolved.missionRel),
    resolved,
    options: { ...options, mission: resolved.missionRel },
  };
}

function evaluateOrInitFailure(
  ctx: VerifyPresentContext,
): { ok: true; result: VerifyPhaseResult } | { ok: false; error: unknown } {
  try {
    assertMissionGatePresent(ctx.mission);
    return { ok: true, result: evaluateVerifyPhases(ctx.root, ctx.mission, ctx.options, ctx.manifest) };
  } catch (e) {
    return { ok: false, error: e };
  }
}

function tryWriteReceiptIfRequested(
  ctx: VerifyPresentContext,
  phaseResult: VerifyPhaseResult,
): { ok: true; receiptPath?: string } | { ok: false; error: unknown } {
  if (ctx.options.receipt === undefined) return { ok: true };
  try {
    const receiptPath = maybeWriteVerifyReceipt({
      root: ctx.root,
      mission: ctx.mission,
      missionArg: ctx.resolved.missionRel,
      options: ctx.options,
      result: phaseResult,
    });
    return { ok: true, receiptPath: receiptPath ?? undefined };
  } catch (e) {
    return { ok: false, error: e };
  }
}

async function resolveFinalPhaseResult(
  ctx: VerifyPresentContext,
  sink: ReturnType<typeof resolveVerifySink>,
  initial: VerifyPhaseResult,
): Promise<VerifyPhaseResult> {
  if (sink !== "fix_interactive" && sink !== "fix_noninteractive") {
    return initial;
  }
  return evaluateWithFixLoop(ctx, initial);
}

function emitMissionBinding(ctx: VerifyPresentContext, sink: ReturnType<typeof resolveVerifySink>): void {
  emitPinnedMissionBanner(ctx.resolved, {
    json: sink === "json" || sink === "break_glass_json",
  });
}

async function evaluateWithFixLoop(
  ctx: VerifyPresentContext,
  initial: VerifyPhaseResult,
): Promise<VerifyPhaseResult> {
  let result = initial;
  if (!ctx.options.fix) return result;

  while (!result.ok) {
    const next = await maybeApplySurgeonAndReevaluate({
      root: ctx.root,
      mission: ctx.mission,
      options: ctx.options,
      manifest: ctx.manifest,
      result,
    });
    if (next === result) break;
    result = next;
  }
  return result;
}

/** Unified verify orchestration: load once, evaluate once, present by sink. */
export async function runVerifyCore(options: VerifyOptions): Promise<VerifyRunResult> {
  const ctx = loadVerifyContext(options);
  const sink = resolveVerifySink(ctx.options);
  emitMissionBinding(ctx, sink);

  switch (sink) {
    case "break_glass_json":
      return presentBreakGlassJson(ctx);
    case "break_glass_human":
      return presentBreakGlassHuman(ctx);
    case "json": {
      const evaluated = evaluateOrInitFailure(ctx);
      if (!evaluated.ok) {
        return presentJsonInitFailure(ctx, evaluated.error);
      }
      const receiptWrite = tryWriteReceiptIfRequested(ctx, evaluated.result);
      if (!receiptWrite.ok) {
        return presentJsonInitFailure(ctx, receiptWrite.error);
      }
      ctx.receiptPath = receiptWrite.receiptPath;
      return presentJsonFromResult(ctx, evaluated.result);
    }
    case "fix_interactive":
    case "fix_noninteractive":
    case "human": {
      try {
        assertMissionGatePresent(ctx.mission);
      } catch (e) {
        return presentHumanInitFailure(ctx, e);
      }
      const initial = evaluateVerifyPhases(ctx.root, ctx.mission, ctx.options, ctx.manifest);
      const finalPhase = await resolveFinalPhaseResult(ctx, sink, initial);
      const receiptWrite = tryWriteReceiptIfRequested(ctx, finalPhase);
      if (!receiptWrite.ok) {
        return presentHumanInitFailure(ctx, receiptWrite.error);
      }
      ctx.receiptPath = receiptWrite.receiptPath;
      if (sink === "fix_interactive") {
        return presentFix(ctx, finalPhase, false);
      }
      if (sink === "fix_noninteractive") {
        return presentFix(ctx, finalPhase, true);
      }
      return presentHuman(ctx, finalPhase);
    }
    default: {
      const _exhaustive: never = sink;
      return _exhaustive;
    }
  }
}

export function buildVerifyResultPayloadFromOptions(options: VerifyOptions): VerifyResultPayload {
  try {
    const { root, manifest } = loadWorkspace();
    const resolved = resolveMissionArg(root, options.mission);
    const mission = parseMissionFile(root, resolved.missionRel);
    assertMissionGatePresent(mission);
    const payload = buildVerifyResultPayload(root, manifest, mission, {
      ...options,
      mission: resolved.missionRel,
    });
    return {
      ...payload,
      mission_file_path: resolved.missionRel,
      mission_source: resolved.source,
    };
  } catch (e) {
    return initFailurePayload(e);
  }
}
