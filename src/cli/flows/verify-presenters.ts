import type { VerifyPhaseResult, VerifyPhaseSuccess } from "#missions/mission-verify/engine.js";
import { CLI_VERSION } from "../version.gen.js";
import type { ResolvedMissionArg } from "./mission-arg.js";
import type { Manifest } from "#core/manifest.js";
import type { ParsedMission } from "#core/mission-types.js";
import type { VerifyOptions } from "./verify-options.js";
import { CLI_NAME } from "#core/constants.js";
import { runBreakGlassAuditFlow } from "#missions/break-glass.js";
import { errorMessage, isGantryUserError } from "#core/user-error.js";
import { Reporter } from "../output/reporter.js";
import { loadPrompts } from "./prompts-loader.js";
import type { VerifyPhaseFailure } from "#missions/mission-verify/failure.js";
import { junitXml, sarifLog } from "#verify/export.js";
import { uriIsDirectory } from "../report/sarif-uri.js";
import fs from "node:fs";
import path from "node:path";
import {
  buildVerifyResultPayloadFromPhaseResult,
  buildBreakGlassPayload,
  initFailurePayload,
  payloadExportFindings,
  payloadJUnitCases,
  type VerifyFailedPayload,
  type VerifyFailure,
  type VerifyResultPayload,
} from "#missions/mission-verify/payload.js";
import { clearRemediationSnapshot, persistVerifyFailure } from "#missions/mission-verify/remediation-pipeline.js";

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
}

export type VerifySink =
  | "break_glass_json"
  | "break_glass_human"
  | "json"
  | "fix_interactive"
  | "fix_noninteractive"
  | "human";

/** Structured export format for verify output (json default when --json). */
export function resolveVerifyExportFormat(options: { format?: VerifyOptions["format"]; json?: boolean }): VerifyOptions["format"] {
  if (options.format) return options.format;
  if (options.json === true) return "json";
  return undefined;
}

export function resolveVerifySink(options: {
  breakGlass?: boolean;
  format?: VerifyOptions["format"];
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
}

/** A settled run: a failure carries its shape as built and its payload as persisted (findings breaker applied). */
export type VerifyRun =
  | { ok: true; result: VerifyPhaseSuccess }
  | { ok: false; result: VerifyPhaseFailure; failure: VerifyFailure; persisted: VerifyFailedPayload };

export function presentBreakGlassJson(ctx: VerifyPresentContext): VerifyPresentResult {
  const payload = buildBreakGlassPayload(ctx.root, ctx.mission, ctx.options);
  emitVerifyDocument(payload, ctx.options, ctx.reporter, { root: ctx.root });
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

/**
 * Structured verify document (JSON, SARIF or JUnit) on stdout, or the file --json-out names. Diagnostics stay on
 * stderr while document stdout is active. JUnit has a case per phase when the phases ran (`result`).
 */
export function emitVerifyDocument(
  payload: VerifyResultPayload,
  options: VerifyPresentContext["options"],
  reporter: Reporter,
  { root, result }: { root?: string; result?: VerifyPhaseResult } = {},
): void {
  const format = resolveVerifyExportFormat(options) ?? "json";
  const isDirectory = (uri: string): boolean => (root ? uriIsDirectory(uri, root) : uri.endsWith("/"));
  const doc =
    format === "junit"
      ? junitXml("gantry-verify", "gantry.verify", payloadJUnitCases(payload, result))
      : JSON.stringify(format === "sarif" ? sarifLog(CLI_VERSION, payloadExportFindings(payload, isDirectory)) : payload, null, 2);
  const jsonOut = options.jsonOut?.trim();
  if (jsonOut) {
    fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
    fs.writeFileSync(jsonOut, `${doc}\n`, "utf8");
    return;
  }
  reporter.document(doc);
}

/** Attach the resolved mission from the loaded verify context. */
function withContextFields<T extends VerifyResultPayload>(
  payload: T,
  ctx: VerifyPresentContext,
): T {
  return {
    ...payload,
    mission_file_path: ctx.resolved.missionRel,
    mission_source: ctx.resolved.source,
  };
}

export function presentJsonFromResult(ctx: VerifyPresentContext, run: VerifyRun): VerifyPresentResult {
  if (run.ok) clearRemediationSnapshot(ctx.root);
  const payload = withContextFields(
    run.ok ? buildVerifyResultPayloadFromPhaseResult(ctx.root, ctx.mission, run.result) : run.persisted,
    ctx,
  );
  emitVerifyDocument(payload, ctx.options, ctx.reporter, { root: ctx.root, result: run.result });
  return { ok: run.ok, exitCode: payload.exit_code };
}

/** Init failures feed the remediation snapshot too (no msn_id, so the findings breaker never trips). */
function persistedInitFailure(ctx: VerifyPresentContext, error: unknown): VerifyFailedPayload {
  const payload = withContextFields(initFailurePayload(error), ctx);
  persistVerifyFailure(ctx.root, payload, { mission_file_path: ctx.options.mission });
  return payload;
}

export function presentJsonInitFailure(
  ctx: VerifyPresentContext,
  error: unknown,
): VerifyPresentResult {
  const payload = persistedInitFailure(ctx, error);
  emitVerifyDocument(payload, ctx.options, ctx.reporter, { root: ctx.root });
  return { ok: false, exitCode: payload.exit_code };
}

export function presentHumanInitFailure(
  ctx: VerifyPresentContext,
  error: unknown,
): VerifyPresentResult {
  const reporter = ctx.reporter;
  const payload = persistedInitFailure(ctx, error);
  if (isGantryUserError(error)) {
    reporter.error(`[${error.gxtCode}] ${error.message}`);
    if (error.hint) reporter.fixHint(error.hint);
    return { ok: false, exitCode: error.exitCode };
  }
  reporter.error(errorMessage(error));
  return { ok: false, exitCode: payload.exit_code };
}

export function presentHuman(ctx: VerifyPresentContext, run: VerifyRun): VerifyPresentResult {
  const reporter = ctx.reporter;
  if (run.ok) {
    clearRemediationSnapshot(ctx.root);
    presentVerifySuccess(reporter, run.result);
    return { ok: true, exitCode: 0 };
  }
  const { failure, persisted } = run;
  reporter.error(`[${persisted.error_code}] ${failure.headline}`);
  for (const line of failure.detail_lines) {
    reporter.error(line.startsWith("---") ? line : `  ${line}`);
  }
  for (const hint of persisted.fix_hints) reporter.fixHint(hint);
  reporter.nextSteps("next actions", persisted.next_actions, failure.tagged_steps);
  return { ok: false, exitCode: persisted.exit_code };
}

/** Interactive --fix: choose among the phase's own hints; code and next steps are the persisted ones. */
export async function presentFixInteractive(ctx: VerifyPresentContext, run: VerifyRun): Promise<VerifyPresentResult> {
  if (run.ok) return presentHuman(ctx, run);
  const { failure, persisted } = run;
  const reporter = ctx.reporter;
  reporter.error(`[${persisted.error_code}] verify failed at phase: ${persisted.phase}`);

  const p = await loadPrompts();
  const choices = failure.payload.fix_hints.map((hint, i) => ({
    value: String(i),
    label: hint.length > 100 ? `${hint.slice(0, 97)}…` : hint,
    hint,
  }));
  choices.push({ value: "quit", label: "Exit (fix manually)", hint: "" });

  const selected = await p.select({
    message: "Choose a remediation step",
    options: choices,
  });

  if (!p.isCancel(selected) && selected !== "quit") {
    const hint = persisted.fix_hints[Number.parseInt(String(selected), 10)];
    if (hint) reporter.fixHint(hint);
  }
  reporter.nextSteps("next actions", persisted.next_actions, failure.tagged_steps);
  return { ok: false, exitCode: persisted.exit_code };
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
