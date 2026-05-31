import path from "node:path";
import { assertTeacherMissionProof } from "./git-proof.js";
import { gatePassed, runGate } from "./gate.js";
import { isLegislativeStub } from "./mission-legislative-stub.js";
import type { ParsedMission } from "./types.js";
import { classifyTraceFailure, type TraceFailureKind } from "./trace-failure-kind.js";
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
}

export interface VerifyPhaseSuccess {
  ok: true;
  outcome: "full" | "pre_push_stub";
  proofMsnId: string;
  workerLogPath: string;
  traceWarnings: TraceVerifyWarning[];
}

export type VerifyPhaseResult = VerifyPhaseFailure | VerifyPhaseSuccess;

export function resolveGateWorkDir(root: string, options: VerifyOptions): string {
  return options.cwd ? path.resolve(root, options.cwd) : root;
}

export function resolveWorkerLogPath(root: string, options: VerifyOptions): string {
  return options.workerLog ? path.resolve(root, options.workerLog) : defaultWorkerLogPath(root);
}

/** Single source of truth for verify phase evaluation (no logging or exit codes). */
export function evaluateVerifyPhases(
  root: string,
  mission: ParsedMission,
  options: VerifyOptions,
): VerifyPhaseResult {
  const workerLogPath = resolveWorkerLogPath(root, options);

  let proofMsnId: string;
  try {
    proofMsnId = assertTeacherMissionProof(root, mission.rawPath, {
      msnId: mission.msnId ?? undefined,
    });
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

  if (options.prePush === true && isLegislativeStub(mission)) {
    return {
      ok: true,
      outcome: "pre_push_stub",
      proofMsnId,
      workerLogPath,
      traceWarnings: [],
    };
  }

  const gate = mission.gate!;
  const workDir = resolveGateWorkDir(root, options);
  const gateResult = runGate(workDir, gate);
  if (!gatePassed(gateResult, gate.successSubstring)) {
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
    const traceKind = classifyTraceFailure(
      first.reason,
      first.row.traceQuote,
      options.strictTrace === true,
    );
    return {
      ok: false,
      phase: "trace",
      message: first.reason,
      exitCode: 1,
      workerLogPath,
      traceKind,
      traceQuote: first.row.traceQuote,
      traceReason: first.reason,
    };
  }

  return {
    ok: true,
    outcome: "full",
    proofMsnId,
    workerLogPath,
    traceWarnings: traceResult.warnings,
  };
}
