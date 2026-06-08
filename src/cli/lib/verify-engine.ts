import path from "node:path";
import { assertTeacherMissionProof } from "./git-proof.js";
import { gatePassed, runGate } from "./gate.js";
import { isLegislativeStub } from "./mission-legislative-stub.js";
import type { Manifest, ParsedMission } from "./types.js";
import { classifyTraceFailure, type TraceFailureKind } from "./trace-failure-kind.js";
import { verifyTraceEvidenceFreshness } from "./trace-evidence.js";
import { defaultWorkerLogPath, verifyTraceRows, type TraceVerifyWarning } from "./trace.js";
import type { VerifyOptions } from "./verify-types.js";

export type VerifyFailurePhase = "git_proof" | "gate" | "trace_pending" | "trace";

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
}

export interface VerifyPhaseSuccess {
  ok: true;
  outcome: "full" | "pre_push_stub";
  proofMsnId: string;
  workerLogPath: string;
  traceWarnings: TraceVerifyWarning[];
  traceEvidenceSkippedUncommitted?: number;
}

export type VerifyPhaseResult = VerifyPhaseFailure | VerifyPhaseSuccess;

export function resolveGateWorkDir(root: string, options: VerifyOptions): string {
  return options.cwd ? path.resolve(root, options.cwd) : root;
}

export function resolveWorkerLogPath(root: string, options: VerifyOptions): string {
  return options.workerLog ? path.resolve(root, options.workerLog) : defaultWorkerLogPath(root);
}

function evaluateGitProof(
  root: string,
  mission: ParsedMission,
  workerLogPath: string,
): VerifyPhaseResult | { proofMsnId: string } {
  try {
    const proofMsnId = assertTeacherMissionProof(root, mission.rawPath, {
      msnId: mission.msnId ?? undefined,
    });
    return { proofMsnId };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      phase: "git_proof",
      message,
      exitCode: 1,
      workerLogPath,
      gitProofMessage: message,
    };
  }
}

function evaluateGatePhase(
  root: string,
  mission: ParsedMission,
  options: VerifyOptions,
  workerLogPath: string,
): VerifyPhaseFailure | null {
  const gate = mission.gate!;
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
): VerifyPhaseFailure | { warnings: TraceVerifyWarning[]; skippedUncommitted: number } {
  const hasPending = mission.traceRows.some((row) => row.status.toUpperCase().includes("PENDING"));
  if (hasPending) {
    return {
      ok: false,
      phase: "trace_pending",
      message:
        "Trace rows still PENDING — worker must execute, update mission trace row, then verify",
      exitCode: 1,
      workerLogPath,
      gateCommand: mission.gate?.command,
    };
  }

  const traceResult = verifyTraceRows(workerLogPath, mission.traceRows, {
    fuzzyNumericAnchor: options.fuzzyTrace === true,
    strictTrace: options.strictTrace === true,
  });

  if (traceResult.failures.length > 0) {
    const first = traceResult.failures[0]!;
    return {
      ok: false,
      phase: "trace",
      message: first.reason,
      exitCode: 1,
      workerLogPath,
      traceKind: classifyTraceFailure(first.reason, first.row.traceQuote, options.strictTrace === true),
      traceQuote: first.row.traceQuote,
      traceReason: first.reason,
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
      ok: false,
      phase: "trace",
      message: first.reason,
      exitCode: 1,
      workerLogPath,
      traceKind: "stale_evidence",
      traceQuote: first.row.traceQuote,
      traceReason: first.reason,
      attestationCommit: first.attestationCommit,
      stalePaths: first.stalePaths,
    };
  }

  return { warnings: traceResult.warnings, skippedUncommitted: evidence.skippedUncommitted };
}

/** Single source of truth for verify phase evaluation (no logging or exit codes). */
export function evaluateVerifyPhases(
  root: string,
  mission: ParsedMission,
  options: VerifyOptions,
  manifest: Manifest,
): VerifyPhaseResult {
  const workerLogPath = resolveWorkerLogPath(root, options);

  const proof = evaluateGitProof(root, mission, workerLogPath);
  if ("ok" in proof) return proof;
  const { proofMsnId } = proof;

  if (options.prePush === true && isLegislativeStub(mission)) {
    return { ok: true, outcome: "pre_push_stub", proofMsnId, workerLogPath, traceWarnings: [] };
  }

  const gateFailure = evaluateGatePhase(root, mission, options, workerLogPath);
  if (gateFailure) return gateFailure;

  const trace = evaluateTracePhase(root, manifest, mission, options, workerLogPath);
  if ("ok" in trace) return trace;

  return {
    ok: true,
    outcome: "full",
    proofMsnId,
    workerLogPath,
    traceWarnings: trace.warnings,
    traceEvidenceSkippedUncommitted:
      trace.skippedUncommitted > 0 ? trace.skippedUncommitted : undefined,
  };
}
