/**
 * Verify pipeline order: engine (this module, evaluates phases — no logging or
 * exit codes) → verify-failure-normalize (canonical failure contract) →
 * verify-hints (remediation) → verify-presenters (sinks) → verify-run (orchestration).
 */
import path from "node:path";
import { formatRepoRelative, toPosixRel } from "./cli-io.js";
import { gitRunOk } from "./git.js";
import { REL_MISSIONS_PREFIX } from "./git-proof.js";
import { isLegislativeStub } from "./missions/formatter.js";
import { defaultExecutorLogPath } from "./trace.js";
import type { GateSpec, KpiFinding, Manifest, ParsedMission } from "./types.js";
import type { GateRunResult } from "./gate.js";
import type { VerifyFailurePhase, VerifyPhaseFailure } from "./verify-failure.js";
import type { TraceVerifyWarning } from "./trace.js";
import {
  createVirtualFlightId,
  purgeVirtualFlightDir,
  scavengeStaleVirtualFlights,
  writeGateCaptureSync,
} from "./virtual-scratch-store.js";
import type { VerifyOptions } from "./verify-options.js";
import { VerifyPhaseClock, type VerifyPhaseId, type VerifyPhaseTiming } from "./verify-phase-clock.js";
import { evaluateInterrogationPhase } from "./verify-interrogation.js";
import {
  evaluateDefensivePhase,
  evaluateGatePhase,
  evaluateGitProof,
  evaluateKpiGatePhase,
  evaluateTracePhase,
  type DefensiveOutcome,
  type KpiOutcome,
  type TracePhaseOutcome,
} from "./verify-phase-steps.js";

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
  defensiveWarnings?: string[];
  defensiveAudits?: string[];
  traceEvidenceSkippedUncommitted?: number;
  phaseTimings: VerifyPhaseTiming[];
}

export type VerifyPhaseResult =
  | (VerifyPhaseFailure & { phaseTimings: VerifyPhaseTiming[] })
  | VerifyPhaseSuccess;

export function resolveExecutorLogPath(root: string, options: VerifyOptions): string {
  return options.executorLog ? path.resolve(root, options.executorLog) : defaultExecutorLogPath(root);
}

function beginVirtualCapture(root: string, mission: ParsedMission): string | null {
  if (!mission.virtualCapture) return null;
  const flightId = createVirtualFlightId();
  scavengeStaleVirtualFlights(root, { protectFlightId: flightId });
  return flightId;
}

function recordVirtualGateCapture(
  root: string,
  flightId: string | null,
  gate: GateSpec,
  gateResult: GateRunResult | undefined,
): void {
  if (!flightId || !gateResult) return;
  writeGateCaptureSync(root, flightId, {
    gate_command: gate.command,
    exit_code: gateResult.exitCode,
    stdout: gateResult.stdout,
    stderr: gateResult.stderr,
  });
}

function failurePhaseToClockId(phase: VerifyFailurePhase): VerifyPhaseId {
  switch (phase) {
    case "git_proof":
      return "git_proof";
    case "interrogation":
      return "interrogation";
    case "gate":
      return "gate";
    case "defensive":
      return "defensive";
    case "kpi":
      return "kpi";
    case "trace":
    case "trace_pending":
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
  defensive: Extract<DefensiveOutcome, { kind: "ok" }>;
  kpi: Extract<KpiOutcome, { kind: "ok" }>;
  phaseTimings: VerifyPhaseTiming[];
}): VerifyPhaseSuccess {
  const { proofMsnId, executorLogPath, trace, gitProofWarnings, defensive, kpi, phaseTimings } =
    input;
  return {
    ok: true,
    outcome: "full",
    proofMsnId,
    executorLogPath,
    traceWarnings: trace.warnings,
    phaseTimings,
    ...(gitProofWarnings.length > 0 ? { gitProofWarnings } : {}),
    ...(kpi.warnings.length > 0 ? { kpiWarnings: kpi.warnings } : {}),
    ...(kpi.advisoryFindings.length > 0 ? { kpiAdvisoryFindings: kpi.advisoryFindings } : {}),
    ...(defensive.warnings.length > 0 ? { defensiveWarnings: defensive.warnings } : {}),
    ...(defensive.audits.length > 0 ? { defensiveAudits: defensive.audits } : {}),
    traceEvidenceSkippedUncommitted:
      trace.skippedUncommitted > 0 ? trace.skippedUncommitted : undefined,
  };
}

/** Single source of truth for verify phase evaluation (no logging or exit codes). */
export function evaluateVerifyPhases(
  root: string,
  mission: ParsedMission,
  options: VerifyOptions,
  manifest: Manifest,
): VerifyPhaseResult {
  const clock = new VerifyPhaseClock();
  const executorLogPath = resolveExecutorLogPath(root, options);

  const proof = clock.timed("git_proof", () =>
    evaluateGitProof(root, mission, options, executorLogPath),
  );
  if (proof.kind === "fail") return failWithTimings(proof.failure, clock);
  const { proofMsnId, warnings: proofWarnings } = proof;

  const missionRel = formatRepoRelative(root, mission.rawPath);
  const interrogation = clock.timed("interrogation", () =>
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
  const gitProofWarnings = [...proofWarnings, ...interrogation.warnings];

  if (options.prePush === true && isLegislativeStub(mission)) {
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

  const gate = mission.gate;
  if (!gate) {
    return failWithTimings(
      {
        ok: false,
        phase: "gate",
        message: "Mission has no gate_command",
        exitCode: 1,
        executorLogPath,
      },
      clock,
    );
  }

  const virtualFlightId = beginVirtualCapture(root, mission);
  const phaseCtx = { root, manifest, mission, options, executorLogPath };

  const gateOutcome = clock.timed("gate", () =>
    evaluateGatePhase(root, gate, options, executorLogPath),
  );
  recordVirtualGateCapture(root, virtualFlightId, gate, gateOutcome.gateResult);
  if (gateOutcome.failure) return failWithTimings(gateOutcome.failure, clock);

  const defensive = clock.timed("defensive", () => evaluateDefensivePhase(phaseCtx));
  if (defensive.kind === "fail") return failWithTimings(defensive.failure, clock);

  const kpi = clock.timed("kpi", () => evaluateKpiGatePhase(phaseCtx));
  if (kpi.kind === "fail") return failWithTimings(kpi.failure, clock);

  const trace = clock.timed("trace", () => evaluateTracePhase(phaseCtx));
  if (trace.kind === "fail") return failWithTimings(trace.failure, clock);

  if (virtualFlightId) purgeVirtualFlightDir(root, virtualFlightId);

  return buildFullVerifySuccess({
    proofMsnId,
    executorLogPath,
    trace,
    gitProofWarnings,
    defensive,
    kpi,
    phaseTimings: clock.finalize(),
  });
}
