import { CLI_NAME } from "./constants.js";
import { assertMissionGatePresent, parseMissionFile } from "./missions/parser.js";
import { GantryUserError } from "./errors.js";
import { loadWorkspace } from "./workspace.js";
import { evaluateVerifyPhases, type VerifyPhaseResult } from "./verify-engine.js";
import type { VerifyOptions } from "./verify-options.js";
import type { Manifest, ParsedMission } from "./types.js";
import {
  buildVerifyResultPayload,
  initFailurePayload,
  type VerifyResultPayload,
} from "./verify-payload.js";
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

export interface VerifyRunResult {
  ok: boolean;
  exitCode: number;
}

interface LoadedVerifyContext {
  root: string;
  manifest: Manifest;
  mission: ParsedMission;
  missionArg: string;
  options: VerifyOptions;
}

function loadVerifyContext(options: VerifyOptions): LoadedVerifyContext {
  const { root, manifest } = loadWorkspace();
  if (!options.mission) {
    throw new Error("gantry verify: --mission is required");
  }
  return {
    root,
    manifest,
    mission: parseMissionFile(root, options.mission),
    missionArg: options.mission,
    options,
  };
}

function evaluateOrInitFailure(
  ctx: LoadedVerifyContext,
): { ok: true; result: VerifyPhaseResult } | { ok: false; error: unknown } {
  try {
    assertMissionGatePresent(ctx.mission);
    return { ok: true, result: evaluateVerifyPhases(ctx.root, ctx.mission, ctx.options, ctx.manifest) };
  } catch (e) {
    return { ok: false, error: e };
  }
}

function tryWriteReceiptIfRequested(
  ctx: LoadedVerifyContext,
  phaseResult: VerifyPhaseResult,
): { ok: true } | { ok: false; error: unknown } {
  if (ctx.options.receipt === undefined) return { ok: true };
  try {
    maybeWriteVerifyReceipt({
      root: ctx.root,
      mission: ctx.mission,
      missionArg: ctx.missionArg,
      options: ctx.options,
      result: phaseResult,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e };
  }
}

async function resolveFinalPhaseResult(
  ctx: LoadedVerifyContext,
  sink: ReturnType<typeof resolveVerifySink>,
  initial: VerifyPhaseResult,
): Promise<VerifyPhaseResult> {
  if (sink !== "fix_interactive" && sink !== "fix_noninteractive") {
    return initial;
  }
  return maybeApplySurgeonAndReevaluate({
    root: ctx.root,
    mission: ctx.mission,
    options: ctx.options,
    manifest: ctx.manifest,
    result: initial,
  });
}

/** Unified verify orchestration: load once, evaluate once, present by sink. */
export async function runVerifyCore(options: VerifyOptions): Promise<VerifyRunResult> {
  const ctx = loadVerifyContext(options);
  const sink = resolveVerifySink(options);

  switch (sink) {
    case "break_glass_json":
      return presentBreakGlassJson(ctx.root, ctx.mission, options);
    case "break_glass_human":
      return presentBreakGlassHuman(ctx.root, ctx.mission, options);
    case "json": {
      const evaluated = evaluateOrInitFailure(ctx);
      if (!evaluated.ok) {
        return presentJsonInitFailure(options, evaluated.error);
      }
      const receiptWrite = tryWriteReceiptIfRequested(ctx, evaluated.result);
      if (!receiptWrite.ok) {
        return presentJsonInitFailure(options, receiptWrite.error);
      }
      return presentJsonFromResult(
        ctx.root,
        ctx.mission,
        ctx.missionArg,
        options,
        ctx.manifest,
        evaluated.result,
      );
    }
    case "fix_interactive":
    case "fix_noninteractive":
    case "human": {
      try {
        assertMissionGatePresent(ctx.mission);
      } catch (e) {
        return presentHumanInitFailure(options, e);
      }
      const initial = evaluateVerifyPhases(ctx.root, ctx.mission, ctx.options, ctx.manifest);
      const finalPhase = await resolveFinalPhaseResult(ctx, sink, initial);
      const receiptWrite = tryWriteReceiptIfRequested(ctx, finalPhase);
      if (!receiptWrite.ok) {
        return presentHumanInitFailure(options, receiptWrite.error);
      }
      if (sink === "fix_interactive") {
        return presentFix(
          ctx.root,
          ctx.mission,
          ctx.missionArg,
          options,
          finalPhase,
          false,
          ctx.manifest,
        );
      }
      if (sink === "fix_noninteractive") {
        return presentFix(
          ctx.root,
          ctx.mission,
          ctx.missionArg,
          options,
          finalPhase,
          true,
          ctx.manifest,
        );
      }
      return presentHuman(ctx.root, ctx.mission, ctx.missionArg, options, finalPhase);
    }
    default: {
      const _exhaustive: never = sink;
      return _exhaustive;
    }
  }
}

export function buildVerifyResultPayloadFromOptions(options: VerifyOptions): VerifyResultPayload {
  try {
    if (!options.mission) {
      throw new GantryUserError("INVALID_ARGUMENT", `${CLI_NAME} verify: --mission is required`, undefined, 2);
    }
    const { root, manifest } = loadWorkspace();
    const mission = parseMissionFile(root, options.mission);
    assertMissionGatePresent(mission);
    return buildVerifyResultPayload(root, manifest, mission, options.mission, options);
  } catch (e) {
    return initFailurePayload(e);
  }
}
