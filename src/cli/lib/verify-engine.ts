import path from "node:path";
import type { OutputAudience } from "./audience-output.js";
import { toPosixRel } from "./cli-io.js";
import { gitRunOk } from "./git.js";
import { assertTeacherMissionProof, REL_MISSIONS_PREFIX } from "./git-proof.js";
import { gatePassed, runGate } from "./gate.js";
import { resolveGateWorkDir } from "./gate-work-dir.js";
import { evaluateKpiPhase } from "./kpi-engine.js";
import { isLegislativeStub } from "./missions/formatter.js";
import type { GateSpec, KpiThresholdOp, Manifest, ParsedMission } from "./types.js";
import { classifyTraceFailure, isPendingStatus, verifyTraceEvidenceFreshness, verifyTraceRows, defaultWorkerLogPath, type TraceFailureKind, type TraceVerifyWarning } from "./trace.js";
import { errorMessage } from "./cli-io.js";

export interface VerifyOptions {
  mission?: string;
  workerLog?: string;
  cwd?: string;
  fuzzyTrace?: boolean;
  strictTrace?: boolean;
  /** Pre-push handoff: legislative stubs stop after git-proof; others run full verify. */
  prePush?: boolean;
  breakGlass?: boolean;
  breakGlassReason?: string;
  breakGlassCommit?: string;
  auditCommit?: boolean;
  /** Interactive remediation menu on failure. */
  fix?: boolean;
  /** Print structured fix hints without prompts (used with --fix). */
  fixNonInteractive?: boolean;
  /** Tailor remediation next steps by role. */
  audience?: OutputAudience;
  /** Skip TMVC stale-evidence binding (committed PASS quote lines only). */
  skipStaleEvidence?: boolean;
  /** Emit a single structured JSON document on stdout (no human logs). */
  json?: boolean;
  /** Verify every mission file changed vs base ref on current branch. */
  changedMissions?: boolean;
  /** Base ref for --changed-missions (default: merge-base with origin/HEAD or main). */
  baseRef?: string;
  /** Authoritative mode: fail-closed on KPI stale evidence and perimeter (CI). */
  ci?: boolean;
  /** Max commits to scan for Teacher [MSN-XXXX] stamp (overrides GXT_MSN_SCAN_DEPTH). */
  scanDepth?: number;
}

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
