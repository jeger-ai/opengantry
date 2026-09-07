import { errorMessage } from "./cli-io.js";
import { assertPlannerMissionProof } from "./git-proof.js";
import { resolveGateWorkDir } from "./gate.js";
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
import type { VerifyOptions } from "./verify-options.js";
import type { TraceVerifyWarning } from "./trace.js";
import { defaultGenericSpawnAdapter } from "./gate-adapters/generic-spawn-adapter.js";
import { readGateLogText, resolveGateLogPaths } from "./gate-log-writer.js";

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

export interface GatePhaseOutcome {
  failure: GateFailure | null;
  gateLogPath?: string;
  exitCode: number | null;
}

export async function evaluateGatePhase(
  input: PhaseContext,
  gate: GateSpec,
): Promise<GatePhaseOutcome> {
  const { root, mission, options, executorLogPath } = input;
  const msnId = mission.msnId ?? "MSN-0000";
  const { abs: gateLogAbs, rel: gateLogRel } = resolveGateLogPaths(root, msnId);
  const adapter = options.gateExecAdapter ?? defaultGenericSpawnAdapter;
  const cwd = resolveGateWorkDir(root, options);

  const result = await adapter.execute(gate.command, {
    msn_id: msnId,
    gate_log_path: gateLogAbs,
    cwd,
    successSubstring: gate.successSubstring,
  });

  if (result.findings.length === 0) {
    return {
      failure: null,
      gateLogPath: gateLogRel,
      exitCode: result.exitCode,
    };
  }

  const logText = readGateLogText(root, gateLogRel);

  return {
    failure: {
      ok: false,
      phase: "gate",
      message: "GATE FAILED",
      exitCode: 1,
      executorLogPath,
      gateCommand: gate.command,
      gateStdout: logText,
      gateStderr: "",
      gateExitCode: result.exitCode ?? undefined,
      gateLogPath: gateLogRel,
      adapterFindings: result.findings,
    },
    gateLogPath: gateLogRel,
    exitCode: result.exitCode,
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
