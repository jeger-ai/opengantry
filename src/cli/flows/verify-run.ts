import { Reporter } from "../output/reporter.js";
import { getRepairForErrorCode, type RepairContext } from "../doctor/repairs/registry.js";
import { appendRepairMutationLog } from "#missions/repair.js";
import { CLI_NAME } from "#core/constants.js";
import path from "node:path";
import { assertMissionGatePresent, parseMissionFile } from "#missions/mission/parser.js";
import { emitPinnedMissionBanner, resolveMissionArg } from "./mission-arg.js";
import { loadWorkspace } from "#missions/workspace.js";
import { evaluateVerifyPhases, type VerifyPhaseResult } from "#missions/mission-verify/engine.js";
import type { VerifyOptions } from "./verify-options.js";
import { msnIdOrDefault } from "#core/mission-types.js";
import { buildAttestationReceipt } from "./attestation-receipt.js";
import { writeAttestationReceipt } from "#plane/attestation-receipt.js";
import { writeAttestationExportEnvelope } from "#plane/attestation-export.js";
import { appendLedgerIfEnabled, ledgerFailureLine, type LedgerAppendOutcome } from "#missions/ledger/ledger-append.js";
import type { LedgerEntryKind } from "#plane/ledger-entry.js";
import type { VerifyPhaseFailure } from "#missions/mission-verify/failure.js";
import {
  buildVerifyResultPayload,
  initFailurePayload,
  verifyFailure,
  type VerifyResultPayload,
} from "#missions/mission-verify/payload.js";
import { GXT_ERROR, type GxtErrorCode } from "#core/error-codes.js";
import { persistVerifyFailure } from "#missions/mission-verify/remediation-pipeline.js";
import { runRecordRelPath } from "#missions/mission-verify/run-record.js";
import {
  resolveVerifySink,
  presentBreakGlassHuman,
  presentBreakGlassJson,
  presentFixInteractive,
  presentHuman,
  presentHumanInitFailure,
  presentJsonFromResult,
  presentJsonInitFailure,
} from "./verify-presenters.js";
import type { VerifyPresentContext, VerifyPresentResult, VerifyRun } from "./verify-presenters.js";

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

function breakGlassErrorCode(options: VerifyOptions): string {
  const reason = options.breakGlassReason?.trim();
  return reason ? `BREAK_GLASS:${reason.slice(0, 120)}` : "BREAK_GLASS";
}

/** Write --receipt / --export for the run's verdict: an error code (failing phase or break-glass) or passed. */
function writeReceiptIfRequested(
  ctx: VerifyPresentContext,
  errorCode: string | undefined,
): { ok: true } | { ok: false; error: unknown } {
  const { options } = ctx;
  const exportOut = options.exportPath?.trim();
  if (options.receipt === undefined && !exportOut) return { ok: true };
  try {
    const receipt = buildAttestationReceipt({
      root: ctx.root,
      mission: ctx.mission,
      missionArg: ctx.resolved.missionRel,
      verifyStatus: errorCode === undefined ? "passed" : "failed",
      errorCode,
      sign: options.signReceipt === true,
    });
    let receiptPath: string | undefined;
    if (options.receipt !== undefined) {
      const explicitOut = typeof options.receipt === "string" && options.receipt.trim() ? options.receipt.trim() : undefined;
      receiptPath = path.resolve(ctx.root, writeAttestationReceipt(ctx.root, receipt, explicitOut));
    }
    if (exportOut) writeAttestationExportEnvelope(ctx.root, receipt, exportOut);
    ctx.receiptPath = receiptPath;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e };
  }
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

/**
 * Settle the run: each failure becomes its final shape once and is persisted (findings breaker); with --fix a gate
 * failure is repaired and the phases re-evaluated until it passes, recurs or no repair applies.
 */
async function settleRun(ctx: VerifyPresentContext, initial: VerifyPhaseResult, fix: boolean): Promise<VerifyRun> {
  let result = initial;
  while (!result.ok) {
    const failure = verifyFailure(ctx.root, ctx.mission, result);
    const persisted = persistVerifyFailure(
      ctx.root,
      failure.payload,
      { mission_file_path: ctx.resolved.missionRel, ...(ctx.mission.msnId ? { msn_id: ctx.mission.msnId } : {}) },
      result.phase === "gate" ? result.gateLogPath : undefined,
    );
    const recurred = persisted.error_code === GXT_ERROR.FINDINGS_RECURRED;
    const next = fix && !recurred ? await repairAndReevaluate(ctx, result, failure.payload.error_code) : result;
    if (next === result) return { ok: false, result, failure, persisted };
    result = next;
  }
  return { ok: true, result };
}

/** One repair mutation pass + phase re-eval only (no nested runVerifyCore). Repairs parse gate output. */
async function repairAndReevaluate(
  ctx: VerifyPresentContext,
  failure: VerifyPhaseFailure,
  errorCode: GxtErrorCode,
): Promise<VerifyPhaseResult> {
  const repair = getRepairForErrorCode(errorCode);
  if (failure.phase !== "gate" || !repair) return failure;

  const executorLogPath = failure.executorLogPath;
  const context: RepairContext = { root: ctx.root, failure, manifest: ctx.manifest, executorLogPath, errorCode };
  const reporter = ctx.reporter;
  reporter.warn(`[Repair] Autonomous mutation triggered for error ${errorCode}`);
  const mutation = await repair.applyMutation(context);
  if (!mutation.mutated) {
    reporter.info(`${CLI_NAME} verify: [Repair] no mutation applied (${mutation.summary})`);
    return failure;
  }

  appendRepairMutationLog(executorLogPath, mutation.summary);
  reporter.info(`${CLI_NAME} verify: [Repair] mutation logged; re-evaluating verify phases (fix disabled)`);

  const reevalOptions: VerifyOptions = { ...ctx.options, fix: false, fixNonInteractive: false, receipt: undefined };
  return await evaluateVerifyPhases(ctx.root, ctx.mission, reevalOptions, ctx.manifest);
}

/** Unified verify orchestration: load once, evaluate once, present by sink. The reporter is the run's one. */
export async function runVerifyCore(options: VerifyOptions, reporter: Reporter = Reporter.forVerify(options)): Promise<VerifyRunResult> {
  const ctx = loadVerifyContext(options, reporter);
  const sink = resolveVerifySink(ctx.options);
  const json = sink === "json" || sink === "break_glass_json";
  emitPinnedMissionBanner(ctx.resolved, { json }, ctx.reporter);
  const initFailure = (error: unknown): VerifyPresentResult =>
    json ? presentJsonInitFailure(ctx, error) : presentHumanInitFailure(ctx, error);

  if (sink === "break_glass_json" || sink === "break_glass_human") {
    const receiptWrite = writeReceiptIfRequested(ctx, breakGlassErrorCode(ctx.options));
    if (!receiptWrite.ok) return initFailure(receiptWrite.error);
    return sink === "break_glass_json" ? presentBreakGlassJson(ctx) : presentBreakGlassHuman(ctx);
  }

  const evaluated = await evaluateOrInitFailure(ctx);
  if (!evaluated.ok) return initFailure(evaluated.error);
  const run = await settleRun(ctx, evaluated.result, sink === "fix_interactive" || sink === "fix_noninteractive");
  const receiptWrite = writeReceiptIfRequested(ctx, run.ok ? undefined : run.failure.payload.error_code);
  if (!receiptWrite.ok) return initFailure(receiptWrite.error);
  appendVerifyOutcomeLedger(ctx, run.result);
  if (sink === "json") return presentJsonFromResult(ctx, run);
  return sink === "fix_interactive" ? await presentFixInteractive(ctx, run) : presentHuman(ctx, run);
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
