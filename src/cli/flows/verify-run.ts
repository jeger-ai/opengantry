import { Reporter } from "../output/reporter.js";
import { assertMissionGatePresent, parseMissionFile } from "#missions/mission/parser.js";
import { emitPinnedMissionBanner, resolveMissionArg } from "./mission-arg.js";
import { loadWorkspace } from "#missions/workspace.js";
import { evaluateVerifyPhases, type VerifyPhaseResult } from "#missions/mission-verify/engine.js";
import type { VerifyOptions } from "./verify-options.js";
import { msnIdOrDefault } from "#core/mission-types.js";
import { writeExportEnvelope } from "#plane/ledger-export.js";
import { runRecordDigest, type RunRecord } from "#core/run-record.js";
import { GantryUserError } from "#core/user-error.js";
import { appendLedgerIfEnabled, ledgerFailureLine, type LedgerAppendOutcome } from "#missions/ledger/ledger-append.js";
import type { LedgerEntryKind } from "#plane/ledger-entry.js";
import {
  buildVerifyResultPayload,
  initFailurePayload,
  verifyFailure,
  type VerifyResultPayload,
} from "#missions/mission-verify/payload.js";
import { persistVerifyFailure } from "#missions/mission-verify/remediation-pipeline.js";
import { missionRunRecord, runRecordRelPath } from "#missions/mission-verify/run-record.js";
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

/** The run record a pass was judged by (or wrote with --record); null for trace-row missions and stubs. */
function passRunRecord(ctx: VerifyPresentContext, result: VerifyPhaseResult): RunRecord | null {
  return result.ok && result.runRecordPath ? missionRunRecord(ctx.root, result.proofMsnId) : null;
}

/** `--export`: the envelope 2.0 over the run record of a pass (ADR-0061); a failed verify keeps its own report and writes none. */
function exportEnvelopeIfRequested(ctx: VerifyPresentContext, run: VerifyRun): unknown {
  const out = ctx.options.exportPath?.trim();
  if (!out) return null;
  if (!run.ok) {
    ctx.reporter.warn("gantry verify --export: verify failed; no envelope written");
    return null;
  }
  try {
    const record = passRunRecord(ctx, run.result);
    if (!record) return new GantryUserError("INVALID_ARGUMENT", `gantry verify --export needs the mission's committed run record (${runRecordRelPath(run.result.proofMsnId)}); run gantry verify --record and commit it`, undefined, 2);
    ctx.reporter.info(`gantry verify --export: wrote ${writeExportEnvelope(ctx.root, record, out, ctx.options.sign === true)}`);
    return null;
  } catch (e) {
    return e;
  }
}

function warnOnLedgerFailure(ctx: VerifyPresentContext, outcome: LedgerAppendOutcome<LedgerEntryKind>): void {
  const line = ledgerFailureLine(outcome);
  if (line !== null) ctx.reporter.warn(line);
}

function appendVerifyOutcomeLedger(ctx: VerifyPresentContext, result: VerifyPhaseResult): void {
  const msnId = msnIdOrDefault(ctx.mission);
  if (result.ok) {
    const record = passRunRecord(ctx, result);
    const payload = record ? { verify_status: "passed", run_record_sha256: runRecordDigest(record) } : { verify_status: "passed" };
    warnOnLedgerFailure(ctx, appendLedgerIfEnabled(ctx.root, "receipt", msnId, payload));
    return;
  }
  warnOnLedgerFailure(ctx, appendLedgerIfEnabled(ctx.root, "verify_findings", msnId, {
    failed_gate: result.phase,
    message: result.message,
  }));
}

/** Settle the run: a failure becomes its final shape once and is persisted (findings breaker). */
function settleRun(ctx: VerifyPresentContext, result: VerifyPhaseResult): VerifyRun {
  if (result.ok) return { ok: true, result };
  const failure = verifyFailure(ctx.root, ctx.mission, result);
  const persisted = persistVerifyFailure(ctx.root, failure.payload, {
    mission_file_path: ctx.resolved.missionRel,
    ...(ctx.mission.msnId ? { msn_id: ctx.mission.msnId } : {}),
  });
  return { ok: false, result, failure, persisted };
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
    return sink === "break_glass_json" ? presentBreakGlassJson(ctx) : presentBreakGlassHuman(ctx);
  }

  const evaluated = await evaluateOrInitFailure(ctx);
  if (!evaluated.ok) return initFailure(evaluated.error);
  const run = settleRun(ctx, evaluated.result);
  appendVerifyOutcomeLedger(ctx, run.result);
  const exportError = exportEnvelopeIfRequested(ctx, run);
  if (exportError !== null) return initFailure(exportError);
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
