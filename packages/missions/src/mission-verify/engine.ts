/**
 * Verify pipeline order: engine (this module, evaluates phases — no logging or exit codes) → payload (each phase
 * failure becomes its final shape once, via hints) → the CLI's verify-run (orchestration) and verify-presenters
 * (sinks) in src/cli/flows.
 */
import path from "node:path";
import { formatRepoRelative, toPosixRel } from "#core/posix-path.js";
import { gitRunOk } from "#git/git.js";
import { REL_MISSIONS_PREFIX } from "../git/git-proof.js";
import { isLegislativeStub } from "../mission/formatter.js";
import { defaultExecutorLogPath } from "../trace-quote.js";
import type { ParsedMission } from "#core/mission-types.js";
import type { Manifest } from "#core/manifest.js";
import type { VerifyPhaseFailure } from "./failure.js";
import type { TraceVerifyWarning } from "../trace-quote.js";
import type { VerifyEvaluation } from "./options.js";
import { evaluateContractPhase } from "./contract.js";
import { evaluateInterrogationPhase } from "./interrogation.js";
import {
  evaluateGatePhase,
  evaluateGitProof,
  evaluateTracePhase,
  type PhaseContext,
  type TracePhaseOutcome,
} from "./phase-steps.js";
import { evaluateDependenciesPhase, evaluatePolicyPhase } from "./org-phases.js";
import { assertCleanTreeForRecord, evaluateRunRecordPhase, missionRunRecord, runRecordRelPath, writeRunRecord } from "./run-record.js";

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
  traceEvidenceSkippedUncommitted?: number;
  /** Set when the evidence was the run record (read or, with --record, written): its repo-relative path. */
  runRecordPath?: string;
}

export type VerifyPhaseResult = VerifyPhaseFailure | VerifyPhaseSuccess;

/** The verify phases in run order; a result's phase statuses follow from it (JUnit cases). */
const VERIFY_PHASE_IDS = ["git_proof", "contract", "interrogation", "policy", "dependencies", "gate", "trace"] as const;
export type VerifyPhaseId = (typeof VERIFY_PHASE_IDS)[number];
export type VerifyPhaseStatus = "passed" | "failed" | "skipped";

export function resolveExecutorLogPath(root: string, options: VerifyEvaluation): string {
  return options.executorLog ? path.resolve(root, options.executorLog) : defaultExecutorLogPath(root);
}

/** Phases run in order and stop at the first failure: earlier ones passed, later ones were skipped. */
export function verifyPhaseStatuses(result: VerifyPhaseResult): { id: VerifyPhaseId; status: VerifyPhaseStatus }[] {
  const failedPhase = result.ok ? null : result.phase === "trace_pending" || result.phase === "run_record" ? "trace" : result.phase;
  const failedAt = failedPhase === null ? -1 : VERIFY_PHASE_IDS.indexOf(failedPhase);
  return VERIFY_PHASE_IDS.map((id, i) => {
    if (result.ok) return { id, status: result.outcome === "pre_push_stub" && (id === "gate" || id === "trace") ? "skipped" : "passed" };
    return { id, status: i < failedAt ? "passed" : i === failedAt ? "failed" : "skipped" };
  });
}

function buildFullVerifySuccess(input: {
  proofMsnId: string;
  executorLogPath: string;
  trace: Extract<TracePhaseOutcome, { kind: "ok" }>;
  gitProofWarnings: string[];
  runRecordPath?: string;
}): VerifyPhaseSuccess {
  const { proofMsnId, executorLogPath, trace, gitProofWarnings, runRecordPath } = input;
  return {
    ok: true,
    outcome: "full",
    proofMsnId,
    executorLogPath,
    traceWarnings: trace.warnings,
    ...(runRecordPath ? { runRecordPath } : {}),
    ...(gitProofWarnings.length > 0 ? { gitProofWarnings } : {}),
    traceEvidenceSkippedUncommitted:
      trace.skippedUncommitted > 0 ? trace.skippedUncommitted : undefined,
  };
}

function evaluateOrgControlPhases(ctx: PhaseContext): VerifyPhaseFailure | null {
  const policy = evaluatePolicyPhase(ctx);
  if (policy.kind === "fail") return policy.failure;
  const deps = evaluateDependenciesPhase(ctx);
  return deps.kind === "fail" ? deps.failure : null;
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
  const executorLogPath = resolveExecutorLogPath(root, options);
  const phaseCtx: PhaseContext = { root, manifest, mission, options, executorLogPath };

  const proof = await evaluateGitProof(root, mission, options, executorLogPath);
  if (proof.kind === "fail") return proof.failure;
  const { proofMsnId, warnings: proofWarnings } = proof;
  if (options.record === true) assertCleanTreeForRecord(root);

  const missionRel = formatRepoRelative(root, mission.rawPath);
  const contract = evaluateContractPhase({ ...phaseCtx, proofMsnId, missionRel });
  if (contract.kind === "fail") return contract.failure;

  const interrogation = await evaluateInterrogationPhase({
      root,
      manifest,
      mission,
      missionRel,
      options,
      proofMsnId,
      executorLogPath,
  });
  if (interrogation.failure) return interrogation.failure;
  const orgFailure = evaluateOrgControlPhases(phaseCtx);
  if (orgFailure) return orgFailure;
  const gitProofWarnings = [...proofWarnings, ...(contract.warnings ?? []), ...interrogation.warnings];

  // A mission without trace rows is a legislative stub only until its run record exists (RULES §3).
  if (options.prePush === true && isLegislativeStub(mission) && !missionRunRecord(root, proofMsnId)) {
    return {
      ok: true,
      outcome: "pre_push_stub",
      proofMsnId,
      executorLogPath,
      traceWarnings: [],
      ...(gitProofWarnings.length > 0 ? { gitProofWarnings } : {}),
    };
  }

  if (!mission.gate) return missingGateFailure(executorLogPath);

  const gate = mission.gate;

  const gateStart = Date.now();
  const gateOutcome = await evaluateGatePhase(phaseCtx, gate);
  const gateMs = Date.now() - gateStart;
  if (gateOutcome.kind === "fail") return gateOutcome.failure;

  const trace = evaluateEvidencePhase(phaseCtx, proofMsnId);
  if (trace.kind === "fail") return trace.failure;
  const runRecordPath = mission.traceRows.length === 0 ? runRecordRelPath(proofMsnId) : undefined;
  if (options.record === true) {
    writeRunRecord(phaseCtx, proofMsnId, { command: gate.command, exit: gateOutcome.exitCode, durationMs: gateMs, logText: gateOutcome.logText });
  }

  return buildFullVerifySuccess({
    proofMsnId,
    executorLogPath,
    trace,
    gitProofWarnings,
    ...(runRecordPath ? { runRecordPath } : {}),
  });
}
