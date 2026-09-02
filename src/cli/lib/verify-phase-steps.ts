import { errorMessage } from "./cli-io.js";
import { assertPlannerMissionProof } from "./git-proof.js";
import { gatePassed, runGate, resolveGateWorkDir, type GateRunResult } from "./gate.js";
import { evaluateKpiPhase } from "./kpi-engine.js";
import { evaluateDefensiveGuardPhase } from "./verify-defensive-phase.js";
import type { GateSpec, KpiFinding, Manifest, ParsedMission } from "./types.js";
import { isPendingStatus, verifyTraceEvidenceFreshness, verifyTraceRows } from "./trace.js";
import type {
  DefensiveFailure,
  GateFailure,
  GitProofFailure,
  KpiFailure,
  TraceFailure,
  TracePendingFailure,
} from "./verify-failure.js";
import type { GateExecInput, VerifyOptions } from "./verify-options.js";
import type { TraceVerifyWarning } from "./trace.js";

function parseDeclaredAnchorLine(anchor: string): number {
  const n = Number.parseInt(anchor.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function gitProofFailure(executorLogPath: string, message: string): GitProofFailure {
  return {
    ok: false,
    phase: "git_proof",
    message,
    exitCode: 1,
    executorLogPath,
    gitProofMessage: message,
  };
}

export type GitProofOutcome =
  | { kind: "ok"; proofMsnId: string; warnings: string[] }
  | { kind: "fail"; failure: GitProofFailure };

export function evaluateGitProof(
  root: string,
  mission: ParsedMission,
  options: VerifyOptions,
  executorLogPath: string,
): GitProofOutcome {
  try {
    const gitProofWarnings: string[] = [];
    const proofMsnId = assertPlannerMissionProof(root, mission.rawPath, {
      msnId: mission.msnId ?? undefined,
      scanDepth: options.scanDepth,
      warnings: gitProofWarnings,
    });
    return { kind: "ok", proofMsnId, warnings: gitProofWarnings };
  } catch (e) {
    return { kind: "fail", failure: gitProofFailure(executorLogPath, errorMessage(e)) };
  }
}

export function defaultGateExecAdapter(input: GateExecInput): GateRunResult {
  return runGate(input.workingDirectory, {
    command: input.command,
    successSubstring: null,
  });
}

export function evaluateGatePhase(
  root: string,
  gate: GateSpec,
  options: VerifyOptions,
  executorLogPath: string,
): { failure: GateFailure | null; gateResult?: GateRunResult } {
  const exec = options.gateExecAdapter ?? defaultGateExecAdapter;
  const gateResult = exec({
    workingDirectory: resolveGateWorkDir(root, options),
    command: gate.command,
  });
  const normalized: GateRunResult = {
    exitCode: gateResult.exitCode,
    stdout: gateResult.stdout,
    stderr: gateResult.stderr,
    combined: `${gateResult.stdout}\n${gateResult.stderr}`,
  };
  if (gatePassed(normalized, gate.successSubstring)) return { failure: null, gateResult: normalized };
  return {
    failure: {
      ok: false,
      phase: "gate",
      message: "GATE FAILED",
      exitCode: 1,
      executorLogPath,
      gateCommand: gate.command,
      gateStdout: normalized.stdout,
      gateStderr: normalized.stderr,
      gateExitCode: normalized.exitCode ?? undefined,
    },
    gateResult: normalized,
  };
}

export type TracePhaseOutcome =
  | { kind: "ok"; warnings: TraceVerifyWarning[]; skippedUncommitted: number }
  | { kind: "fail"; failure: TracePendingFailure | TraceFailure };

export interface PhaseContext {
  root: string;
  manifest: Manifest;
  mission: ParsedMission;
  options: VerifyOptions;
  executorLogPath: string;
}

export function evaluateTracePhase(input: PhaseContext): TracePhaseOutcome {
  const { root, manifest, mission, options, executorLogPath } = input;
  const hasPending = mission.traceRows.some((row) => isPendingStatus(row.status));
  if (hasPending) {
    return {
      kind: "fail",
      failure: {
        ok: false,
        phase: "trace_pending",
        message:
          "Trace rows still PENDING — executor must execute, update mission trace row, then verify",
        exitCode: 1,
        executorLogPath,
        gateCommand: mission.gate?.command,
      },
    };
  }

  const traceResult = verifyTraceRows(executorLogPath, mission.traceRows, {
    fuzzyNumericAnchor: options.fuzzyTrace === true,
    strictTrace: options.strictTrace === true,
  });

  if (traceResult.failures.length > 0) {
    const first = traceResult.failures[0]!;
    return {
      kind: "fail",
      failure: {
        ok: false,
        phase: "trace",
        message: first.reason,
        exitCode: 1,
        executorLogPath,
        traceKind: first.kind,
        traceQuote: first.row.traceQuote,
        traceReason: first.reason,
        declaredLine: parseDeclaredAnchorLine(first.row.anchor),
      },
    };
  }

  const evidence = verifyTraceEvidenceFreshness(
    root,
    manifest,
    mission.skillKey,
    executorLogPath,
    traceResult.resolvedLines,
    { skipStaleEvidence: options.skipStaleEvidence === true },
  );

  if (evidence.failures.length > 0) {
    const first = evidence.failures[0]!;
    return {
      kind: "fail",
      failure: {
        ok: false,
        phase: "trace",
        message: first.reason,
        exitCode: 1,
        executorLogPath,
        traceKind: "stale_evidence",
        traceQuote: first.row.traceQuote,
        traceReason: first.reason,
        declaredLine: parseDeclaredAnchorLine(first.row.anchor),
        attestationCommit: first.attestationCommit,
        stalePaths: first.stalePaths,
      },
    };
  }

  return { kind: "ok", warnings: traceResult.warnings, skippedUncommitted: evidence.skippedUncommitted };
}

export type DefensiveOutcome =
  | { kind: "ok"; warnings: string[]; audits: string[] }
  | { kind: "fail"; failure: DefensiveFailure };

export type KpiOutcome =
  | { kind: "ok"; warnings: string[]; advisoryFindings: KpiFinding[] }
  | { kind: "fail"; failure: KpiFailure };

export function evaluateDefensivePhase(input: PhaseContext): DefensiveOutcome {
  const { root, manifest, mission, executorLogPath } = input;
  if (!mission.skillKey) return { kind: "ok", warnings: [], audits: [] };
  const defensiveOutcome = evaluateDefensiveGuardPhase(
    root,
    manifest,
    mission.skillKey,
    executorLogPath,
  );
  if (defensiveOutcome.failure) return { kind: "fail", failure: defensiveOutcome.failure };
  return {
    kind: "ok",
    warnings: defensiveOutcome.warnings,
    audits: defensiveOutcome.audits,
  };
}

export function evaluateKpiGatePhase(input: PhaseContext): KpiOutcome {
  const { root, manifest, mission, options, executorLogPath } = input;
  if (!mission.kpiGate) return { kind: "ok", warnings: [], advisoryFindings: [] };
  const kpiOutcome = evaluateKpiPhase(
    root,
    manifest,
    mission.skillKey,
    mission.kpiGate,
    options,
    executorLogPath,
  );
  if (kpiOutcome?.kind === "fail") return { kind: "fail", failure: kpiOutcome.failure };
  if (kpiOutcome?.kind === "ok") {
    return {
      kind: "ok",
      warnings: kpiOutcome.warnings,
      advisoryFindings: kpiOutcome.advisoryFindings ?? [],
    };
  }
  return { kind: "ok", warnings: [], advisoryFindings: [] };
}
