import type { VerifyPhaseSuccess } from "#missions/mission-verify/engine.js";
import { CLI_VERSION } from "../version.gen.js";
import type { AudienceTaggedStep } from "#missions/mission-verify/hints.js";
import type { ResolvedMissionArg } from "./mission-arg.js";
import type { Manifest } from "#core/manifest.js";
import type { ParsedMission } from "#core/mission-types.js";
import type { VerifyOptions } from "./verify-options.js";
import { CLI_NAME } from "#core/constants.js";
import { runBreakGlassAuditFlow } from "#missions/break-glass.js";
import { errorMessage, isGantryUserError } from "#core/user-error.js";
import { Reporter } from "../output/reporter.js";
import { loadPrompts } from "./prompts-loader.js";
import type { VerifyPhaseResult } from "#missions/mission-verify/engine.js";
import type { VerifyPhaseFailure } from "#missions/mission-verify/failure.js";
import type { VerifyPhaseTiming } from "#missions/mission-verify/phase-clock.js";
import { buildVerifyExportDocument, type VerifyExportFormat } from "#missions/mission-verify/export.js";
import type { JUnitCase } from "#verify/export.js";
import { uriIsDirectory } from "../report/sarif-uri.js";
import fs from "node:fs";
import path from "node:path";
import {
  buildFindingsForFailure,
  buildVerifyResultPayloadFromPhaseResult,
  buildBreakGlassPayload,
  initFailurePayload,
  toVerifyFailedPayload,
  type VerifyResultPayload,
} from "#missions/mission-verify/payload.js";
import { hintsForVerifyPhase } from "#missions/mission-verify/hints.js";
import {
  normalizeVerifyPhaseFailure,
  toFailurePresentation,
  type VerifyFailurePresentation,
} from "#missions/mission-verify/failure-normalize.js";
import { persistRemediationFromFailedPayload } from "#missions/context-feed-remediation.js";
import {
  persistFailedVerifyRemediation,
  tombstoneRemediationSnapshot,
} from "#missions/mission-verify/remediation-pipeline.js";
import { readRemediationSnapshot, type RemediationSnapshot } from "#missions/context-feed-store.js";
import type { GxtErrorCode } from "#core/error-codes.js";

/** Shared verify orchestration context (load once, present by sink). */
export interface VerifyPresentContext {
  root: string;
  manifest: Manifest;
  mission: ParsedMission;
  /** Flag vs pin resolution — single source for mission_source in payloads. */
  resolved: ResolvedMissionArg;
  options: VerifyOptions;
  /** The run's one reporter, built from the options at the entry point. */
  reporter: Reporter;
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
  jsonOut?: string;
  fix?: boolean;
  fixNonInteractive?: boolean;
}): VerifySink {
  if (options.breakGlass === true) {
    return options.json || options.format || options.jsonOut?.trim() ? "break_glass_json" : "break_glass_human";
  }
  if (resolveVerifyExportFormat(options) || options.jsonOut?.trim()) return "json";
  if (options.fix === true) {
    return options.fixNonInteractive ? "fix_noninteractive" : "fix_interactive";
  }
  return "human";
}

export interface VerifyPresentResult {
  ok: boolean;
  exitCode: number;
  remediation?: RemediationSnapshot | null;
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
  emitStructuredPayload(payload, ctx.options, ctx.reporter, { root: ctx.root });
  return { ok: payload.exit_code === 0, exitCode: payload.exit_code };
}

export function presentBreakGlassHuman(ctx: VerifyPresentContext): VerifyPresentResult {
  const reporter = ctx.reporter;
  const outcome = runBreakGlassAuditFlow(ctx.root, ctx.mission, ctx.options);
  if (outcome.kind === "fail") {
    reporter.error(errorMessage(outcome.error));
    return { ok: false, exitCode: 2 };
  }
  for (const w of outcome.warnings) reporter.warn(w);
  reporter.info(`${CLI_NAME} verify: BREAK-GLASS — all gates skipped (audited on ${outcome.commitSha})`);
  reporter.info(`  reason: ${outcome.reason}`);
  if (outcome.msnId) reporter.info(`  msn_id: ${outcome.msnId}`);
  if (outcome.auditCommit) {
    reporter.fixHint("git push origin HEAD  # audit empty commit (no gxt-bypass note)");
  } else {
    reporter.fixHint("git push origin refs/notes/gxt-bypass");
  }
  return { ok: true, exitCode: 0 };
}

function junitCasesFor(timings: VerifyPhaseTiming[], payload: VerifyResultPayload): JUnitCase[] {
  const failureText = payload.status === "failed" ? payload.message : undefined;
  return timings.map((row) => {
    if (row.status === "skipped") return { name: row.id, skipped: true };
    if (row.status === "failed") return { name: row.id, failure: failureText ?? "failed" };
    return { name: row.id };
  });
}

function emitStructuredPayload(
  payload: VerifyResultPayload,
  options: VerifyPresentContext["options"],
  reporter: Reporter,
  extras?: { root?: string; junitCases?: JUnitCase[] },
): void {
  const format: VerifyExportFormat = resolveVerifyExportFormat(options) ?? "json";
  const root = extras?.root;
  const doc = buildVerifyExportDocument(payload, format, CLI_VERSION, {
    ...(root ? { isDirectory: (uri: string) => uriIsDirectory(uri, root) } : {}),
    junitCases: extras?.junitCases,
  });
  const jsonOut = options.jsonOut?.trim();
  if (jsonOut) {
    fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
    fs.writeFileSync(jsonOut, `${doc}\n`, "utf8");
    return;
  }
  reporter.document(doc);
}

/** Structured verify document on stdout. Diagnostics stay on stderr while document stdout is active. */
export function emitVerifyDocument(
  payload: VerifyResultPayload,
  options: VerifyPresentContext["options"],
  reporter: Reporter,
  extras?: { root?: string; junitCases?: JUnitCase[] },
): void {
  emitStructuredPayload(payload, options, reporter, extras);
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
  if (result.ok) {
    tombstoneRemediationSnapshot(ctx.root);
    const payload = withContextFields(
      buildVerifyResultPayloadFromPhaseResult(ctx.root, ctx.mission, ctx.options, result),
      ctx,
    );
    emitStructuredPayload(payload, ctx.options, ctx.reporter, {
      root: ctx.root,
      junitCases: junitCasesFor(result.phaseTimings, payload),
    });
    return { ok: true, exitCode: 0, remediation: null };
  }
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
  const { payload, snapshot } = persistFailedVerifyRemediation({
    root: ctx.root,
    mission: ctx.mission,
    missionRel: ctx.resolved.missionRel,
    payload: toVerifyFailedPayload(normalized, failure, findings),
    findings,
    failure,
  });
  const fullPayload = withContextFields(payload, ctx);
  emitStructuredPayload(fullPayload, ctx.options, ctx.reporter, {
    root: ctx.root,
    junitCases: junitCasesFor(result.phaseTimings, fullPayload),
  });
  return { ok: false, exitCode: payload.exit_code, remediation: snapshot };
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
  emitStructuredPayload(payload, ctx.options, ctx.reporter, { root: ctx.root });
  return { ok: false, exitCode: payload.exit_code };
}

export function presentHumanInitFailure(
  ctx: VerifyPresentContext,
  error: unknown,
): VerifyPresentResult {
  const reporter = ctx.reporter;
  const payload = withContextFields(initFailurePayload(error), ctx);
  try {
    persistRemediationFromFailedPayload(ctx.root, null, ctx.options.mission, payload);
  } catch {
    // best-effort remediation feed
  }
  if (isGantryUserError(error)) {
    reporter.error(`[${error.gxtCode}] ${error.message}`);
    if (error.hint) reporter.fixHint(error.hint);
    return { ok: false, exitCode: error.exitCode };
  }
  reporter.error(errorMessage(error));
  return { ok: false, exitCode: payload.exit_code };
}

export function presentHuman(
  ctx: VerifyPresentContext,
  result: VerifyPhaseResult,
): VerifyPresentResult {
  const reporter = ctx.reporter;
  if (result.ok) {
    tombstoneRemediationSnapshot(ctx.root);
    presentVerifySuccess(reporter, result);
    if (ctx.receiptPath) reporter.info(`${CLI_NAME} verify: wrote ${ctx.receiptPath}`);
    return { ok: true, exitCode: 0, remediation: null };
  }
  if (ctx.receiptPath) reporter.info(`${CLI_NAME} verify: wrote ${ctx.receiptPath}`);
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
  let presentation: typeof basePresentation;

  let remediation: RemediationSnapshot | undefined;
  if (ctx.options.fix === true) {
    presentation = presentationFromPersistedSnapshot(ctx.root, msnId, basePresentation);
  } else {
    const failure = result as VerifyPhaseFailure;
    const findings = buildFindingsForFailure(ctx.root, normalized, failure);
    const persisted = persistFailedVerifyRemediation({
      root: ctx.root,
      mission: ctx.mission,
      missionRel: ctx.resolved.missionRel,
      payload: toVerifyFailedPayload(normalized, failure, findings),
      findings,
      failure,
    });
    remediation = persisted.snapshot;
    presentation = overlayFailurePresentation(basePresentation, persisted.payload);
  }

  presentFailure(reporter, presentation);
  return { ok: false, exitCode: presentation.exit_code, remediation: remediation ?? null };
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
  const reporter = ctx.reporter;
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

  reporter.error(`[${presentation.error_code}] verify failed at phase: ${failure.phase}`);

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
    presentNextSteps(reporter, presentation.next_actions, remediation.tagged_steps);
    return { ok: false, exitCode: failure.exitCode };
  }

  const idx = Number.parseInt(String(selected), 10);
  const hint = presentation.fix_hints[idx];
  if (hint) reporter.fixHint(hint);
  presentNextSteps(reporter, presentation.next_actions, remediation.tagged_steps);
  return { ok: false, exitCode: failure.exitCode };
}

function presentVerifySuccess(reporter: Reporter, result: VerifyPhaseSuccess): void {
  reporter.info(`${CLI_NAME} verify: git-proof OK (Planner legislation for ${result.proofMsnId})`);
  for (const w of result.gitProofWarnings ?? []) reporter.warn(w);
  if (result.outcome === "pre_push_stub") {
    reporter.info(
      `${CLI_NAME} verify: legislative stub OK (remote handoff; git-proof passed — run full verify after execution)`,
    );
    return;
  }
  reporter.info(`${CLI_NAME} verify: gate passed`);
  for (const w of result.kpiWarnings ?? []) reporter.info(`  ${w}`);
  for (const warning of result.traceWarnings) {
    const tag = warning.autoResolved ? "auto-resolved" : "drift";
    reporter.info(
      `  trace: line ${tag} DoD ${warning.row.dodId} — declared ${String(warning.declaredLine)}, found ${String(warning.foundLine)}`,
    );
  }
  if (result.traceEvidenceSkippedUncommitted !== undefined) {
    reporter.info(
      `  trace evidence: ${String(result.traceEvidenceSkippedUncommitted)} uncommitted EXECUTOR_LOG line(s) skipped stale check`,
    );
  }
  if (result.runRecordPath) reporter.info(`${CLI_NAME} verify: run record OK (${result.runRecordPath})`);
  else reporter.info(`${CLI_NAME} verify: trace mapping OK (${result.executorLogPath})`);
}

function presentFailure(reporter: Reporter, presentation: VerifyFailurePresentation): void {
  reporter.error(`[${presentation.error_code}] ${presentation.headline}`);
  for (const line of presentation.detail_lines) {
    reporter.error(line.startsWith("---") ? line : `  ${line}`);
  }
  for (const hint of presentation.fix_hints) reporter.fixHint(hint);
  presentNextSteps(reporter, presentation.next_actions, presentation.tagged_steps);
}

function presentNextSteps(reporter: Reporter, steps: string[], tagged?: AudienceTaggedStep[]): void {
  reporter.nextSteps("next actions", steps, tagged);
}
