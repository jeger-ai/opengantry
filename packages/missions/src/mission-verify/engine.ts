/**
 * Verify pipeline order: engine (this module, evaluates phases — no logging or exit codes) → failure-normalize
 * (canonical failure contract) → hints (remediation) → the CLI's verify-presenters (sinks) and verify-run
 * (orchestration) in src/cli/flows.
 */
import path from "node:path";
import { formatRepoRelative, toPosixRel } from "#core/posix-path.js";
import { gitRunOk } from "#git/git.js";
import { REL_MISSIONS_PREFIX } from "../git/git-proof.js";
import { isLegislativeStub } from "../mission/formatter.js";
import { defaultExecutorLogPath } from "../trace-quote.js";
import type { KpiFinding, ParsedMission } from "#core/mission-types.js";
import type { Manifest } from "#core/manifest.js";
import type { VerifyFailurePhase, VerifyPhaseFailure } from "./failure.js";
import type { TraceVerifyWarning } from "../trace-quote.js";
import type { VerifyEvaluation } from "./options.js";
import { VerifyPhaseClock, type VerifyPhaseId, type VerifyPhaseTiming } from "./phase-clock.js";
import { evaluateContractPhase } from "./contract.js";
import { evaluateInterrogationPhase } from "./interrogation.js";
import {
  evaluateGatePhase,
  evaluateGitProof,
  evaluateKpiGatePhase,
  evaluateTracePhase,
  type KpiOutcome,
  type PhaseContext,
  type TracePhaseOutcome,
} from "./phase-steps.js";
import { evaluateDependenciesPhase, evaluatePolicyPhase } from "./org-phases.js";
import { assertCleanTreeForRecord, evaluateRunRecordPhase, missionHasRunRecord, runRecordRelPath, writeRunRecord } from "./run-record.js";

const MISSION_EXTENSIONS = new Set([".yaml", ".yml", ".md"]);

function isMissionFile(repoRel: string): boolean {
  const norm = repoRel.replace(/\\/g, "/");
  if (!norm.startsWith(REL_MISSIONS_PREFIX)) return false;
  const ext = path.extname(norm).toLowerCase();
  return MISSION_EXTENSIONS.has(ext);
}

/** Discover mission files changed between baseRef and HEAD (inclusive triple-dot). */
export function discoverChangedMissionFiles(repoRoot: string, baseRef: string): string[] {
  const { ok, stdout } = gitRunOk(repoRoot, [
    "diff",
    "--name-only",
    `${baseRef}...HEAD`,
    "--",
    REL_MISSIONS_PREFIX,
  ]);
  if (!ok) return [];
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && isMissionFile(line))
    .map((rel) => toPosixRel(repoRoot, path.join(repoRoot, rel)));
}

export interface VerifyPhaseSuccess {
  ok: true;
  outcome: "full" | "pre_push_stub";
  proofMsnId: string;
  executorLogPath: string;
  traceWarnings: TraceVerifyWarning[];
  gitProofWarnings?: string[];
  kpiWarnings?: string[];
  kpiAdvisoryFindings?: KpiFinding[];
  traceEvidenceSkippedUncommitted?: number;
  /** Set when the evidence was the run record (read or, with --record, written): its repo-relative path. */
  runRecordPath?: string;
  phaseTimings: VerifyPhaseTiming[];
}

export type VerifyPhaseResult =
  | (VerifyPhaseFailure & { phaseTimings: VerifyPhaseTiming[] })
  | VerifyPhaseSuccess;

export function resolveExecutorLogPath(root: string, options: VerifyEvaluation): string {
  return options.executorLog ? path.resolve(root, options.executorLog) : defaultExecutorLogPath(root);
}

function failurePhaseToClockId(phase: VerifyFailurePhase): VerifyPhaseId {
  switch (phase) {
    case "git_proof":
      return "git_proof";
    case "interrogation":
      return "interrogation";
    case "policy":
      return "policy";
    case "dependencies":
      return "dependencies";
    case "contract":
      return "contract";
    case "gate":
      return "gate";
    case "kpi":
      return "kpi";
    case "trace":
    case "trace_pending":
    case "run_record":
      return "trace";
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

function failWithTimings(failure: VerifyPhaseFailure, clock: VerifyPhaseClock): VerifyPhaseResult {
  clock.markFailed(failurePhaseToClockId(failure.phase));
  return { ...failure, phaseTimings: clock.finalize() };
}

function buildFullVerifySuccess(input: {
  proofMsnId: string;
  executorLogPath: string;
  trace: Extract<TracePhaseOutcome, { kind: "ok" }>;
  gitProofWarnings: string[];
  kpi: Extract<KpiOutcome, { kind: "ok" }>;
  phaseTimings: VerifyPhaseTiming[];
  runRecordPath?: string;
}): VerifyPhaseSuccess {
  const { proofMsnId, executorLogPath, trace, gitProofWarnings, kpi, phaseTimings, runRecordPath } =
    input;
  return {
    ok: true,
    outcome: "full",
    proofMsnId,
    executorLogPath,
    traceWarnings: trace.warnings,
    phaseTimings,
    ...(runRecordPath ? { runRecordPath } : {}),
    ...(gitProofWarnings.length > 0 ? { gitProofWarnings } : {}),
    ...(kpi.warnings.length > 0 ? { kpiWarnings: kpi.warnings } : {}),
    ...(kpi.advisoryFindings.length > 0 ? { kpiAdvisoryFindings: kpi.advisoryFindings } : {}),
    traceEvidenceSkippedUncommitted:
      trace.skippedUncommitted > 0 ? trace.skippedUncommitted : undefined,
  };
}

async function evaluateOrgControlPhases(
  clock: VerifyPhaseClock,
  ctx: PhaseContext,
): Promise<{ failure: VerifyPhaseFailure } | { warnings: string[] }> {
  const policy = await clock.timed("policy", () => evaluatePolicyPhase(ctx));
  if (policy.kind === "fail") return { failure: policy.failure };
  const deps = await clock.timed("dependencies", () => evaluateDependenciesPhase(ctx));
  return deps.kind === "fail" ? { failure: deps.failure } : { warnings: deps.warnings };
}

/**
 * Evidence (RULES §3): a mission with trace rows is judged by them (legacy mode); one without rows binds its PASS to
 * the committed run record, unless this run is the one producing it (--record).
 */
function evaluateEvidencePhase(ctx: PhaseContext, proofMsnId: string): TracePhaseOutcome {
  const useRunRecord = ctx.mission.traceRows.length === 0 && ctx.options.record !== true;
  if (!useRunRecord) return evaluateTracePhase(ctx);
  const record = evaluateRunRecordPhase(ctx, proofMsnId);
  return record.kind === "ok" ? { kind: "ok", warnings: [], skippedUncommitted: 0 } : record;
}

function missingGateFailure(executorLogPath: string): VerifyPhaseFailure {
  return { ok: false, phase: "gate", message: "Mission has no gate_command", exitCode: 1, executorLogPath };
}

/** Single source of truth for verify phase evaluation (no logging or exit codes). */
export async function evaluateVerifyPhases(
  root: string,
  mission: ParsedMission,
  options: VerifyEvaluation,
  manifest: Manifest,
): Promise<VerifyPhaseResult> {
  const clock = new VerifyPhaseClock();
  const executorLogPath = resolveExecutorLogPath(root, options);
  const phaseCtx: PhaseContext = { root, manifest, mission, options, executorLogPath };

  const proof = await clock.timed("git_proof", () =>
    evaluateGitProof(root, mission, options, executorLogPath),
  );
  if (proof.kind === "fail") return failWithTimings(proof.failure, clock);
  const { proofMsnId, warnings: proofWarnings } = proof;
  if (options.record === true) assertCleanTreeForRecord(root);

  const missionRel = formatRepoRelative(root, mission.rawPath);
  const contract = await clock.timed("contract", () =>
    evaluateContractPhase({ ...phaseCtx, proofMsnId, missionRel }),
  );
  if (contract.kind === "fail") return failWithTimings(contract.failure, clock);

  const interrogation = await clock.timed("interrogation", () =>
    evaluateInterrogationPhase({
      root,
      manifest,
      mission,
      missionRel,
      options,
      proofMsnId,
      executorLogPath,
    }),
  );
  if (interrogation.failure) return failWithTimings(interrogation.failure, clock);
  const org = await evaluateOrgControlPhases(clock, phaseCtx);
  if ("failure" in org) return failWithTimings(org.failure, clock);
  const gitProofWarnings = [...proofWarnings, ...interrogation.warnings, ...org.warnings];

  // A mission without trace rows is a legislative stub only until its run record exists (RULES §3).
  if (options.prePush === true && isLegislativeStub(mission) && !missionHasRunRecord(root, proofMsnId)) {
    return {
      ok: true,
      outcome: "pre_push_stub",
      proofMsnId,
      executorLogPath,
      traceWarnings: [],
      phaseTimings: clock.finalize(),
      ...(gitProofWarnings.length > 0 ? { gitProofWarnings } : {}),
    };
  }

  if (!mission.gate) return failWithTimings(missingGateFailure(executorLogPath), clock);

  const gate = mission.gate;

  const gateOutcome = await clock.timed("gate", () => evaluateGatePhase(phaseCtx, gate));
  if (gateOutcome.kind === "fail") return failWithTimings(gateOutcome.failure, clock);

  const kpi = await clock.timed("kpi", () => evaluateKpiGatePhase(phaseCtx));
  if (kpi.kind === "fail") return failWithTimings(kpi.failure, clock);

  const trace = await clock.timed("trace", () => evaluateEvidencePhase(phaseCtx, proofMsnId));
  if (trace.kind === "fail") return failWithTimings(trace.failure, clock);
  const runRecordPath = mission.traceRows.length === 0 ? runRecordRelPath(proofMsnId) : undefined;
  if (options.record === true) {
    writeRunRecord(phaseCtx, proofMsnId, { command: gate.command, exit: gateOutcome.exitCode, durationMs: clock.durationOf("gate"), logText: gateOutcome.logText });
  }

  return buildFullVerifySuccess({
    proofMsnId,
    executorLogPath,
    trace,
    gitProofWarnings,
    kpi,
    phaseTimings: clock.finalize(),
    ...(runRecordPath ? { runRecordPath } : {}),
  });
}
