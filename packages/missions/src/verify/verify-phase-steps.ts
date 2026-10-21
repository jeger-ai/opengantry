import { errorMessage } from "#core/user-error.js";
import { assertPlannerMissionProof } from "../git/git-proof.js";
import { resolveGateWorkDir } from "../gate.js";
import { evaluateKpiPhase } from "../kpi-engine.js";
import { msnIdOrDefault, type GateSpec, type KpiFinding, type ParsedMission } from "#core/mission-types.js";
import { type Manifest } from "#core/manifest.js";
import { isPendingStatus } from "#core/trace-status.js";
import { verifyTraceEvidenceFreshness } from "../trace-evidence.js";
import { verifyTraceRows } from "../trace-quote.js";
import type {
  GateFailure,
  GitProofFailure,
  KpiFailure,
  TraceFailure,
  TracePendingFailure,
  RunRecordFailure,
} from "./verify-failure.js";
import type { VerifyOptions } from "./verify-options.js";
import type { TraceVerifyWarning } from "../trace-quote.js";
import { resolveGateExecAdapter } from "../gate-adapters/registry.js";
import { ensureGateLogPath, readGateLogText } from "../gate-log-writer.js";

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

export type GatePhaseOutcome =
  | { kind: "ok"; exitCode: number | null; gateLogPath: string; logText: string }
  | { kind: "fail"; exitCode: number | null; gateLogPath: string; logText: string; failure: GateFailure };

export async function evaluateGatePhase(
  input: PhaseContext,
  gate: GateSpec,
): Promise<GatePhaseOutcome> {
  const { root, mission, options, executorLogPath } = input;
  const msnId = msnIdOrDefault(mission);
  const { abs: gateLogAbs, rel: gateLogRel } = ensureGateLogPath(root, msnId);
  const adapter = options.gateExecAdapter ?? resolveGateExecAdapter(gate.adapter);
  const cwd = resolveGateWorkDir(root, options);

  const result = await adapter(gate.command, {
    cwd,
    repoRoot: root,
    gateLogPath: gateLogAbs,
    successSubstring: gate.successSubstring,
  });

  const logText = readGateLogText(root, gateLogRel);

  if (result.findings.length === 0) {
    return {
      kind: "ok",
      exitCode: result.exitCode,
      gateLogPath: gateLogRel,
      logText,
    };
  }

  return {
    kind: "fail",
    exitCode: result.exitCode,
    gateLogPath: gateLogRel,
    logText,
    failure: {
      ok: false,
      phase: "gate",
      message: "GATE FAILED",
      exitCode: 1,
      executorLogPath,
      gateCommand: gate.command,
      gateOutput: logText,
      gateAdapter: gate.adapter,
      gateExitCode: result.exitCode ?? undefined,
      gateLogPath: gateLogRel,
      adapterFindings: result.findings,
    },
  };
}

export type TracePhaseOutcome =
  | { kind: "ok"; warnings: TraceVerifyWarning[]; skippedUncommitted: number }
  | { kind: "fail"; failure: TracePendingFailure | TraceFailure | RunRecordFailure };

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

export type KpiOutcome =
  | { kind: "ok"; warnings: string[]; advisoryFindings: KpiFinding[] }
  | { kind: "fail"; failure: KpiFailure };

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
