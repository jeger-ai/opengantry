import path from "node:path";
import { assertTeacherMissionProof } from "./git-proof.js";
import { gatePassed, runGate } from "./gate.js";
import { evaluateKpiPhase } from "./kpi-phase.js";
import { isLegislativeStub } from "./mission-legislative-stub.js";
import type { GateSpec, Manifest, ParsedMission } from "./types.js";
import type { KpiThresholdOp } from "./types.js";
import { classifyTraceFailure, type TraceFailureKind } from "./trace-failure-kind.js";
import { isPendingStatus } from "./trace-status.js";
import { verifyTraceEvidenceFreshness } from "./trace-evidence.js";
import { defaultWorkerLogPath, verifyTraceRows, type TraceVerifyWarning } from "./trace.js";
import type { VerifyOptions } from "./verify-types.js";
import { errorMessage } from "./cli-io.js";

export type VerifyFailurePhase = "git_proof" | "gate" | "kpi" | "trace_pending" | "trace";

export interface VerifyPhaseFailure {
  ok: false;
  phase: VerifyFailurePhase;
  message: string;
  exitCode: number;
  workerLogPath: string;
  gateCommand?: string;
  gateStdout?: string;
  gateStderr?: string;
  gateExitCode?: number;
  gitProofMessage?: string;
  traceKind?: TraceFailureKind;
  traceQuote?: string;
  traceReason?: string;
  attestationCommit?: string;
  stalePaths?: string[];
  kpiReportPath?: string;
  kpiReason?: string;
  kpiMetric?: string;
  kpiOp?: KpiThresholdOp;
  kpiExpected?: number;
  kpiActual?: number | boolean;
  kpiStalePaths?: string[];
}

export interface VerifyPhaseSuccess {
  ok: true;
  outcome: "full" | "pre_push_stub";
  proofMsnId: string;
  workerLogPath: string;
  traceWarnings: TraceVerifyWarning[];
  kpiWarnings?: string[];
  traceEvidenceSkippedUncommitted?: number;
}

export type VerifyPhaseResult = VerifyPhaseFailure | VerifyPhaseSuccess;

type GitProofOutcome =
  | { kind: "ok"; proofMsnId: string }
  | { kind: "fail"; failure: VerifyPhaseFailure };

type TracePhaseOutcome =
  | { kind: "ok"; warnings: TraceVerifyWarning[]; skippedUncommitted: number }
  | { kind: "fail"; failure: VerifyPhaseFailure };

function gitProofFailure(
  workerLogPath: string,
  message: string,
): VerifyPhaseFailure {
  return {
    ok: false,
    phase: "git_proof",
    message,
    exitCode: 1,
    workerLogPath,
    gitProofMessage: message,
  };
}

function tracePhaseFailure(
  phase: "trace_pending" | "trace",
  workerLogPath: string,
  fields: Omit<VerifyPhaseFailure, "ok" | "phase" | "workerLogPath">,
): VerifyPhaseFailure {
  return { ok: false, phase, workerLogPath, ...fields };
}

export function resolveGateWorkDir(root: string, options: VerifyOptions): string {
  return options.cwd ? path.resolve(root, options.cwd) : root;
}

export function resolveWorkerLogPath(root: string, options: VerifyOptions): string {
  return options.workerLog ? path.resolve(root, options.workerLog) : defaultWorkerLogPath(root);
}

function evaluateGitProof(
  root: string,
  mission: ParsedMission,
  options: VerifyOptions,
  workerLogPath: string,
): GitProofOutcome {
  try {
    const proofMsnId = assertTeacherMissionProof(root, mission.rawPath, {
      msnId: mission.msnId ?? undefined,
      scanDepth: options.scanDepth,
    });
    return { kind: "ok", proofMsnId };
  } catch (e) {
    return { kind: "fail", failure: gitProofFailure(workerLogPath, errorMessage(e)) };
  }
}

function evaluateGatePhase(
  root: string,
  gate: GateSpec,
  options: VerifyOptions,
  workerLogPath: string,
): VerifyPhaseFailure | null {
  const gateResult = runGate(resolveGateWorkDir(root, options), gate);
  if (gatePassed(gateResult, gate.successSubstring)) return null;
  return {
    ok: false,
    phase: "gate",
    message: "GATE FAILED",
    exitCode: 1,
    workerLogPath,
    gateCommand: gate.command,
    gateStdout: gateResult.stdout,
    gateStderr: gateResult.stderr,
    gateExitCode: gateResult.exitCode ?? undefined,
  };
}

function evaluateTracePhase(
  root: string,
  manifest: Manifest,
  mission: ParsedMission,
  options: VerifyOptions,
  workerLogPath: string,
): TracePhaseOutcome {
  const hasPending = mission.traceRows.some((row) => isPendingStatus(row.status));
  if (hasPending) {
    return {
      kind: "fail",
      failure: tracePhaseFailure("trace_pending", workerLogPath, {
        message:
          "Trace rows still PENDING — worker must execute, update mission trace row, then verify",
        exitCode: 1,
        gateCommand: mission.gate?.command,
      }),
    };
  }

  const traceResult = verifyTraceRows(workerLogPath, mission.traceRows, {
    fuzzyNumericAnchor: options.fuzzyTrace === true,
    strictTrace: options.strictTrace === true,
  });

  if (traceResult.failures.length > 0) {
    const first = traceResult.failures[0]!;
    return {
      kind: "fail",
      failure: tracePhaseFailure("trace", workerLogPath, {
        message: first.reason,
        exitCode: 1,
        traceKind: classifyTraceFailure(first.reason, first.row.traceQuote, options.strictTrace === true),
        traceQuote: first.row.traceQuote,
        traceReason: first.reason,
      }),
    };
  }

  const evidence = verifyTraceEvidenceFreshness(
    root,
    manifest,
    mission.skillKey,
    workerLogPath,
    traceResult.resolvedLines,
    { skipStaleEvidence: options.skipStaleEvidence === true },
  );

  if (evidence.failures.length > 0) {
    const first = evidence.failures[0]!;
    return {
      kind: "fail",
      failure: tracePhaseFailure("trace", workerLogPath, {
        message: first.reason,
        exitCode: 1,
        traceKind: "stale_evidence",
        traceQuote: first.row.traceQuote,
        traceReason: first.reason,
        attestationCommit: first.attestationCommit,
        stalePaths: first.stalePaths,
      }),
    };
  }

  return { kind: "ok", warnings: traceResult.warnings, skippedUncommitted: evidence.skippedUncommitted };
}

/** Single source of truth for verify phase evaluation (no logging or exit codes). */
export function evaluateVerifyPhases(
  root: string,
  mission: ParsedMission,
  options: VerifyOptions,
  manifest: Manifest,
): VerifyPhaseResult {
  const workerLogPath = resolveWorkerLogPath(root, options);

  const proof = evaluateGitProof(root, mission, options, workerLogPath);
  if (proof.kind === "fail") return proof.failure;
  const { proofMsnId } = proof;

  if (options.prePush === true && isLegislativeStub(mission)) {
    return { ok: true, outcome: "pre_push_stub", proofMsnId, workerLogPath, traceWarnings: [] };
  }

  const gate = mission.gate;
  if (!gate) {
    return {
      ok: false,
      phase: "gate",
      message: "Mission has no gate_command",
      exitCode: 1,
      workerLogPath,
    };
  }

  const gateFailure = evaluateGatePhase(root, gate, options, workerLogPath);
  if (gateFailure) return gateFailure;

  let kpiWarnings: string[] | undefined;
  if (mission.kpiGate) {
    const kpiOutcome = evaluateKpiPhase(
      root,
      manifest,
      mission.skillKey,
      mission.kpiGate,
      options,
      workerLogPath,
    );
    if (kpiOutcome && "ok" in kpiOutcome && kpiOutcome.ok === false) {
      return kpiOutcome;
    }
    if (kpiOutcome && "warnings" in kpiOutcome) {
      kpiWarnings = kpiOutcome.warnings;
    }
  }

  const trace = evaluateTracePhase(root, manifest, mission, options, workerLogPath);
  if (trace.kind === "fail") return trace.failure;

  return {
    ok: true,
    outcome: "full",
    proofMsnId,
    workerLogPath,
    traceWarnings: trace.warnings,
    ...(kpiWarnings && kpiWarnings.length > 0 ? { kpiWarnings } : {}),
    traceEvidenceSkippedUncommitted:
      trace.skippedUncommitted > 0 ? trace.skippedUncommitted : undefined,
  };
}
