import { Reporter } from "../output/reporter.js";
import { getRepairForErrorCode, resolveRepairErrorCode, type RepairContext } from "../doctor/repairs/registry.js";
import { appendRepairMutationLog } from "#missions/repair.js";
import { CLI_NAME } from "#core/constants.js";
import path from "node:path";
import { assertMissionGatePresent, parseMissionFile } from "#missions/mission/parser.js";
import { emitPinnedMissionBanner, resolveMissionArg } from "./mission-arg.js";
import { loadWorkspace } from "#missions/workspace.js";
import { evaluateVerifyPhases, resolveExecutorLogPath, type VerifyPhaseResult, type VerifyPhaseSuccess } from "#missions/mission-verify/engine.js";
import type { VerifyOptions } from "./verify-options.js";
import { msnIdOrDefault, type ParsedMission } from "#core/mission-types.js";
import { buildAttestationReceipt } from "./attestation-receipt.js";
import { writeAttestationReceipt } from "#plane/attestation-receipt.js";
import { writeAttestationExportEnvelope } from "#plane/attestation-export.js";
import { appendLedgerIfEnabled, ledgerFailureLine, type LedgerAppendOutcome } from "#missions/ledger/ledger-append.js";
import type { LedgerEntryKind } from "#plane/ledger-entry.js";
import { normalizeVerifyPhaseFailure } from "#missions/mission-verify/failure-normalize.js";
import type { VerifyPhaseFailure } from "#missions/mission-verify/failure.js";
import {
  buildFindingsForFailure,
  buildVerifyResultPayload,
  initFailurePayload,
  toVerifyFailedPayload,
  type VerifyResultPayload,
} from "#missions/mission-verify/payload.js";
import { GXT_ERROR } from "#core/error-codes.js";
import { persistFailedVerifyRemediation } from "#missions/mission-verify/remediation-pipeline.js";
import { runRecordRelPath } from "#missions/mission-verify/run-record.js";
import {
  resolveVerifySink,
  presentBreakGlassHuman,
  presentBreakGlassJson,
  presentFix,
  presentHuman,
  presentHumanInitFailure,
  presentJsonFromResult,
  presentJsonInitFailure,
} from "./verify-presenters.js";
import type { VerifyPresentContext, VerifyPresentResult } from "./verify-presenters.js";

/** Shared verify orchestration context (load once, present by sink). */

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

function loadVerifyContext(options: VerifyOptions, reporter: Reporter): VerifyPresentContext {
  const { root, manifest } = loadWorkspace();
  const resolved = resolveMissionArg(root, options.mission);
  return {
    root,
    manifest,
    mission: parseMissionFile(root, resolved.missionRel),
    resolved,
    options: { ...options, mission: resolved.missionRel },
    reporter,
  };
}

async function evaluateOrInitFailure(
  ctx: VerifyPresentContext,
): Promise<{ ok: true; result: VerifyPhaseResult } | { ok: false; error: unknown }> {
  try {
    assertMissionGatePresent(ctx.mission);
    const result = await evaluateVerifyPhases(ctx.root, ctx.mission, ctx.options, ctx.manifest);
    if (ctx.options.record === true && result.ok && result.outcome === "full") {
      ctx.reporter.info(`gantry verify --record: wrote ${runRecordRelPath(result.proofMsnId)}; commit it (RULES §3)`);
    }
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e };
  }
}

function breakGlassPhaseStub(ctx: VerifyPresentContext): VerifyPhaseSuccess {
  return {
    ok: true,
    outcome: "full",
    proofMsnId: msnIdOrDefault(ctx.mission),
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

function warnOnLedgerFailure(ctx: VerifyPresentContext, outcome: LedgerAppendOutcome<LedgerEntryKind>): void {
  const line = ledgerFailureLine(outcome);
  if (line !== null) ctx.reporter.warn(line);
}

function appendVerifyOutcomeLedger(ctx: VerifyPresentContext, result: VerifyPhaseResult): void {
  const msnId = msnIdOrDefault(ctx.mission);
  if (result.ok) {
    warnOnLedgerFailure(ctx, appendLedgerIfEnabled(ctx.root, "receipt", msnId, { verify_status: "passed" }));
    return;
  }
  warnOnLedgerFailure(ctx, appendLedgerIfEnabled(ctx.root, "verify_findings", msnId, {
    failed_gate: result.phase,
    message: result.message,
  }));
}

function emitMissionBinding(ctx: VerifyPresentContext, sink: ReturnType<typeof resolveVerifySink>): void {
  emitPinnedMissionBanner(ctx.resolved, { json: sink === "json" || sink === "break_glass_json" }, ctx.reporter);
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
    const { payload } = persistFailedVerifyRemediation({
      root: ctx.root,
      mission: ctx.mission,
      missionRel: ctx.resolved.missionRel,
      payload: toVerifyFailedPayload(normalized, failure, findings),
      findings,
      failure,
    });
    if (payload.error_code === GXT_ERROR.FINDINGS_RECURRED) break;

    const next = await maybeApplyRepairAndReevaluate({
      reporter: ctx.reporter,
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

/** One repair mutation pass + phase re-eval only (no nested runVerifyCore). */
async function maybeApplyRepairAndReevaluate(input: {
  root: string;
  reporter: Reporter;
  mission: VerifyPresentContext["mission"];
  options: VerifyPresentContext["options"];
  manifest: VerifyPresentContext["manifest"];
  result: VerifyPhaseResult;
}): Promise<VerifyPhaseResult> {
  if (input.result.ok) return input.result;
  if (input.options.fix !== true) return input.result;

  const failure = input.result as VerifyPhaseFailure;
  if (failure.phase !== "gate") return input.result;

  const errorCode = resolveRepairErrorCode(failure);
  if (!errorCode) return input.result;

  const repair = getRepairForErrorCode(errorCode);
  if (!repair) return input.result;

  const executorLogPath = failure.executorLogPath;
  const context: RepairContext = {
    root: input.root,
    failure,
    manifest: input.manifest,
    executorLogPath,
    errorCode,
  };

  const reporter = input.reporter;
  reporter.warn(`[Repair] Autonomous mutation triggered for error ${errorCode}`);
  const mutation = await repair.applyMutation(context);
  if (!mutation.mutated) {
    reporter.info(`${CLI_NAME} verify: [Repair] no mutation applied (${mutation.summary})`);
    return input.result;
  }

  appendRepairMutationLog(executorLogPath, mutation.summary);
  reporter.info(`${CLI_NAME} verify: [Repair] mutation logged; re-evaluating verify phases (fix disabled)`);

  const reevalOptions: VerifyPresentContext["options"] = {
    ...input.options,
    fix: false,
    fixNonInteractive: false,
    receipt: undefined,
  };
  return await evaluateVerifyPhases(input.root, input.mission, reevalOptions, input.manifest);
}

/** Unified verify orchestration: load once, evaluate once, present by sink. The reporter is the run's one. */
export async function runVerifyCore(options: VerifyOptions, reporter: Reporter = Reporter.forVerify(options)): Promise<VerifyRunResult> {
  const ctx = loadVerifyContext(options, reporter);
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
      const evaluated = await evaluateOrInitFailure(ctx);
      if (!evaluated.ok) {
        return presentJsonInitFailure(ctx, evaluated.error);
      }
      const receiptWrite = tryWriteReceiptIfRequested(ctx, evaluated.result);
      if (!receiptWrite.ok) {
        return presentJsonInitFailure(ctx, receiptWrite.error);
      }
      ctx.receiptPath = receiptWrite.receiptPath;
      appendVerifyOutcomeLedger(ctx, evaluated.result);
      return presentJsonFromResult(ctx, evaluated.result);
    }
    case "fix_interactive":
    case "fix_noninteractive":
    case "human": {
      const evaluated = await evaluateOrInitFailure(ctx);
      if (!evaluated.ok) {
        return presentHumanInitFailure(ctx, evaluated.error);
      }
      const finalPhase = await resolveFinalPhaseResult(ctx, sink, evaluated.result);
      const receiptWrite = tryWriteReceiptIfRequested(ctx, finalPhase);
      if (!receiptWrite.ok) {
        return presentHumanInitFailure(ctx, receiptWrite.error);
      }
      ctx.receiptPath = receiptWrite.receiptPath;
      appendVerifyOutcomeLedger(ctx, finalPhase);
      let presented: VerifyPresentResult;
      if (sink === "fix_interactive") {
        presented = await presentFix(ctx, finalPhase, false);
      } else if (sink === "fix_noninteractive") {
        presented = await presentFix(ctx, finalPhase, true);
      } else {
        presented = presentHuman(ctx, finalPhase);
      }
      return presented;
    }
    default: {
      const _exhaustive: never = sink;
      return _exhaustive;
    }
  }
}

export async function buildVerifyResultPayloadFromOptions(options: VerifyOptions): Promise<VerifyResultPayload> {
  try {
    const { root, manifest } = loadWorkspace();
    const resolved = resolveMissionArg(root, options.mission);
    const mission = parseMissionFile(root, resolved.missionRel);
    assertMissionGatePresent(mission);
    const payload = await buildVerifyResultPayload(root, manifest, mission, {
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
