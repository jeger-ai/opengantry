import path from "node:path";
import { assertMissionGatePresent, parseMissionFile } from "./missions/parser.js";
import { emitPinnedMissionBanner, resolveMissionArg } from "./mission-arg.js";
import { loadWorkspace } from "./workspace.js";
import { evaluateVerifyPhases, resolveExecutorLogPath, type VerifyPhaseResult, type VerifyPhaseSuccess } from "./verify-engine.js";
import type { VerifyOptions } from "./verify-options.js";
import type { ParsedMission } from "./types.js";
import {
  buildAttestationReceipt,
  writeAttestationReceipt,
} from "./attestation-receipt.js";
import { writeAttestationExportEnvelope } from "./attestation-export.js";
import { normalizeVerifyPhaseFailure } from "./verify-failure-normalize.js";
import type { VerifyPhaseFailure } from "./verify-failure.js";
import {
  buildFindingsForFailure,
  buildVerifyResultPayload,
  initFailurePayload,
  toVerifyFailedPayload,
  type VerifyResultPayload,
} from "./verify-payload.js";
import { GXT_ERROR } from "./gxt-error-codes.js";
import { persistFailedVerifyRemediation } from "./verify-remediation-pipeline.js";
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
import type { VerifyPresentContext } from "./verify-presenters.js";

/** Shared verify orchestration context (load once, present by sink). */
export type { VerifyPresentContext } from "./verify-presenters.js";

function resolveReceiptOutPath(options: VerifyOptions): string | undefined {
  if (options.receipt === undefined) return undefined;
  if (typeof options.receipt === "string" && options.receipt.trim()) {
    return options.receipt.trim();
  }
  return undefined;
}

export function maybeWriteVerifyReceipt(input: {
  root: string;
  mission: ParsedMission;
  missionArg: string;
  options: VerifyOptions;
  result: VerifyPhaseResult;
  breakGlass?: boolean;
}): { receiptPath: string | null; exportPath: string | null } {
  if (!wantsReceiptOrExport(input.options)) {
    return { receiptPath: null, exportPath: null };
  }

  const verifyStatus = input.breakGlass === true ? "failed" : input.result.ok ? "passed" : "failed";
  let errorCode: string | undefined;
  if (input.breakGlass === true) {
    errorCode = "BREAK_GLASS";
    if (input.options.breakGlassReason?.trim()) {
      errorCode = `BREAK_GLASS:${input.options.breakGlassReason.trim().slice(0, 120)}`;
    }
  } else if (!input.result.ok) {
    const normalized = normalizeVerifyPhaseFailure({
      failure: input.result as VerifyPhaseFailure,
      missionArg: input.missionArg,
      options: input.options,
      root: input.root,
      msnId: input.mission.msnId ?? undefined,
      mission: input.mission,
    });
    errorCode = normalized.error_code;
  }

  const receipt = buildAttestationReceipt({
    root: input.root,
    mission: input.mission,
    missionArg: input.missionArg,
    verifyStatus,
    errorCode,
    sign: input.options.signReceipt === true,
  });

  let receiptPath: string | null = null;
  if (input.options.receipt !== undefined) {
    const explicitOut = resolveReceiptOutPath(input.options);
    const written = writeAttestationReceipt(input.root, receipt, explicitOut);
    receiptPath = path.resolve(input.root, written);
  }

  let exportPath: string | null = null;
  const exportOut = input.options.exportPath?.trim();
  if (exportOut) {
    exportPath = writeAttestationExportEnvelope(input.root, receipt, exportOut);
  }

  return { receiptPath, exportPath };
}

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

function breakGlassPhaseStub(ctx: VerifyPresentContext): VerifyPhaseSuccess {
  return {
    ok: true,
    outcome: "full",
    proofMsnId: ctx.mission.msnId ?? "MSN-0000",
    executorLogPath: resolveExecutorLogPath(ctx.root, ctx.options),
    traceWarnings: [],
  };
}

function tryWriteReceiptIfRequested(
  ctx: VerifyPresentContext,
  phaseResult: VerifyPhaseResult,
  breakGlass = false,
): { ok: true; receiptPath?: string; exportPath?: string } | { ok: false; error: unknown } {
  if (!wantsReceiptOrExport(ctx.options)) return { ok: true };
  try {
    const written = maybeWriteVerifyReceipt({
      root: ctx.root,
      mission: ctx.mission,
      missionArg: ctx.resolved.missionRel,
      options: ctx.options,
      result: phaseResult,
      breakGlass,
    });
    return {
      ok: true,
      receiptPath: written.receiptPath ?? undefined,
      exportPath: written.exportPath ?? undefined,
    };
  } catch (e) {
    return { ok: false, error: e };
  }
}

function wantsReceiptOrExport(options: VerifyOptions): boolean {
  return options.receipt !== undefined || !!options.exportPath?.trim();
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
    const failure = result as VerifyPhaseFailure;
    const normalized = normalizeVerifyPhaseFailure({
      failure,
      missionArg: ctx.resolved.missionRel,
      options: ctx.options,
      root: ctx.root,
      msnId: ctx.mission.msnId ?? undefined,
      mission: ctx.mission,
    });
    const findings = buildFindingsForFailure(ctx.root, normalized, failure);
    const payload = persistFailedVerifyRemediation(
      ctx.root,
      ctx.mission,
      ctx.resolved.missionRel,
      toVerifyFailedPayload(normalized, failure, findings),
      findings,
    );
    if (payload.error_code === GXT_ERROR.FINDINGS_RECURRED) break;

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
    case "break_glass_json": {
      const receiptWrite = tryWriteReceiptIfRequested(ctx, breakGlassPhaseStub(ctx), true);
      if (!receiptWrite.ok) {
        return presentJsonInitFailure(ctx, receiptWrite.error);
      }
      ctx.receiptPath = receiptWrite.receiptPath;
      return presentBreakGlassJson(ctx);
    }
    case "break_glass_human": {
      const receiptWrite = tryWriteReceiptIfRequested(ctx, breakGlassPhaseStub(ctx), true);
      if (!receiptWrite.ok) {
        return presentHumanInitFailure(ctx, receiptWrite.error);
      }
      ctx.receiptPath = receiptWrite.receiptPath;
      return presentBreakGlassHuman(ctx);
    }
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
