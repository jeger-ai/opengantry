import path from "node:path";
import type { OutputAudience } from "./audience-output.js";
import { toPosixRel } from "./cli-io.js";
import { gitRunOk } from "./git.js";
import { assertPlannerMissionProof, REL_MISSIONS_PREFIX } from "./git-proof.js";
import { gatePassed, runGate, resolveGateWorkDir, type GateRunResult } from "./gate.js";
import { evaluateKpiPhase } from "./kpi-engine.js";
import { evaluateDefensiveGuardPhase } from "./verify-defensive-phase.js";
import { isLegislativeStub } from "./missions/formatter.js";
import type { GateSpec, KpiThresholdOp, Manifest, ParsedMission } from "./types.js";
import { isPendingStatus, verifyTraceEvidenceFreshness, verifyTraceRows, defaultExecutorLogPath, type TraceFailureKind, type TraceVerifyWarning } from "./trace.js";
import { errorMessage } from "./cli-io.js";
import {
  createVirtualFlightId,
  purgeVirtualFlightDir,
  scavengeStaleVirtualFlights,
  writeGateCaptureSync,
} from "./virtual-scratch-store.js";
import type { VerifyExportFormat } from "./verify-export.js";

export type { VerifyExportFormat } from "./verify-export.js";

export function resolveVerifyExportFormat(options: VerifyOptions): VerifyExportFormat | undefined {
  if (options.format) return options.format;
  if (options.json === true) return "json";
  return undefined;
}

export interface VerifyOptions {
  mission?: string;
  executorLog?: string;
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
  /** Structured export format (json default when --json). */
  format?: VerifyExportFormat;
  /** Verify every mission file changed vs base ref on current branch. */
  changedMissions?: boolean;
  /** Base ref for --changed-missions (default: merge-base with origin/HEAD or main). */
  baseRef?: string;
  /** Authoritative mode: fail-closed on KPI stale evidence and perimeter (CI). */
  ci?: boolean;
  /** Max commits to scan for Planner [MSN-XXXX] stamp (overrides GXT_MSN_SCAN_DEPTH). */
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

export type VerifyFailurePhase = "git_proof" | "gate" | "defensive" | "kpi" | "trace_pending" | "trace";

export type KpiFailureKind = "missing" | "invalid" | "stale" | "threshold" | "exit_code";

export interface VerifyPhaseFailure {
  ok: false;
  phase: VerifyFailurePhase;
  message: string;
  exitCode: number;
  executorLogPath: string;
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
  kpiKind?: KpiFailureKind;
  kpiReason?: string;
  kpiMetric?: string;
  kpiOp?: KpiThresholdOp;
  kpiExpected?: number;
  kpiActual?: number | boolean;
  kpiStalePaths?: string[];
  defensiveReason?: string;
  defensiveNetLoc?: number;
  defensiveMaxNetLoc?: number;
  defensiveWarnings?: string[];
  defensiveAudits?: string[];
}

export interface VerifyPhaseSuccess {
  ok: true;
  outcome: "full" | "pre_push_stub";
  proofMsnId: string;
  executorLogPath: string;
  traceWarnings: TraceVerifyWarning[];
  gitProofWarnings?: string[];
  kpiWarnings?: string[];
  defensiveWarnings?: string[];
  defensiveAudits?: string[];
  traceEvidenceSkippedUncommitted?: number;
}

export type VerifyPhaseResult = VerifyPhaseFailure | VerifyPhaseSuccess;

type GitProofOutcome =
  | { kind: "ok"; proofMsnId: string; warnings: string[] }
  | { kind: "fail"; failure: VerifyPhaseFailure };

type TracePhaseOutcome =
  | { kind: "ok"; warnings: TraceVerifyWarning[]; skippedUncommitted: number }
  | { kind: "fail"; failure: VerifyPhaseFailure };

function gitProofFailure(
  executorLogPath: string,
  message: string,
): VerifyPhaseFailure {
  return {
    ok: false,
    phase: "git_proof",
    message,
    exitCode: 1,
    executorLogPath,
    gitProofMessage: message,
  };
}

function tracePhaseFailure(
  phase: "trace_pending" | "trace",
  executorLogPath: string,
  fields: Omit<VerifyPhaseFailure, "ok" | "phase" | "executorLogPath">,
): VerifyPhaseFailure {
  return { ok: false, phase, executorLogPath, ...fields };
}

export function resolveExecutorLogPath(root: string, options: VerifyOptions): string {
  return options.executorLog ? path.resolve(root, options.executorLog) : defaultExecutorLogPath(root);
}

function evaluateGitProof(
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

function evaluateGatePhase(
  root: string,
  gate: GateSpec,
  options: VerifyOptions,
  executorLogPath: string,
): { failure: VerifyPhaseFailure | null; gateResult?: ReturnType<typeof runGate> } {
  const gateResult = runGate(resolveGateWorkDir(root, options), gate);
  if (gatePassed(gateResult, gate.successSubstring)) return { failure: null, gateResult };
  return {
    failure: {
      ok: false,
      phase: "gate",
      message: "GATE FAILED",
      exitCode: 1,
      executorLogPath,
      gateCommand: gate.command,
      gateStdout: gateResult.stdout,
      gateStderr: gateResult.stderr,
      gateExitCode: gateResult.exitCode ?? undefined,
    },
    gateResult,
  };
}

function evaluateTracePhase(
  root: string,
  manifest: Manifest,
  mission: ParsedMission,
  options: VerifyOptions,
  executorLogPath: string,
): TracePhaseOutcome {
  const hasPending = mission.traceRows.some((row) => isPendingStatus(row.status));
  if (hasPending) {
    return {
      kind: "fail",
      failure: tracePhaseFailure("trace_pending", executorLogPath, {
        message:
          "Trace rows still PENDING — executor must execute, update mission trace row, then verify",
        exitCode: 1,
        gateCommand: mission.gate?.command,
      }),
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
      failure: tracePhaseFailure("trace", executorLogPath, {
        message: first.reason,
        exitCode: 1,
        traceKind: first.kind,
        traceQuote: first.row.traceQuote,
        traceReason: first.reason,
      }),
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
      failure: tracePhaseFailure("trace", executorLogPath, {
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

function collectDefensiveAndKpiOutcomes(
  root: string,
  manifest: Manifest,
  mission: ParsedMission,
  options: VerifyOptions,
  executorLogPath: string,
): VerifyPhaseFailure | { kpiWarnings?: string[]; defensiveWarnings?: string[]; defensiveAudits?: string[] } {
  let kpiWarnings: string[] | undefined;
  let defensiveWarnings: string[] | undefined;
  let defensiveAudits: string[] | undefined;

  if (mission.skillKey) {
    const defensiveOutcome = evaluateDefensiveGuardPhase(
      root,
      manifest,
      mission.skillKey,
      executorLogPath,
    );
    if (defensiveOutcome.failure) return defensiveOutcome.failure;
    if (defensiveOutcome.warnings.length > 0) defensiveWarnings = defensiveOutcome.warnings;
    if (defensiveOutcome.audits.length > 0) defensiveAudits = defensiveOutcome.audits;
  }

  if (mission.kpiGate) {
    const kpiOutcome = evaluateKpiPhase(
      root,
      manifest,
      mission.skillKey,
      mission.kpiGate,
      options,
      executorLogPath,
    );
    if (kpiOutcome?.kind === "fail") return kpiOutcome.failure;
    if (kpiOutcome?.kind === "ok") kpiWarnings = kpiOutcome.warnings;
  }

  return { kpiWarnings, defensiveWarnings, defensiveAudits };
}

function buildFullVerifySuccess(
  proofMsnId: string,
  executorLogPath: string,
  trace: Extract<TracePhaseOutcome, { kind: "ok" }>,
  gitProofWarnings: string[],
  extras: { kpiWarnings?: string[]; defensiveWarnings?: string[]; defensiveAudits?: string[] },
): VerifyPhaseSuccess {
  return {
    ok: true,
    outcome: "full",
    proofMsnId,
    executorLogPath,
    traceWarnings: trace.warnings,
    ...(gitProofWarnings.length > 0 ? { gitProofWarnings } : {}),
    ...(extras.kpiWarnings && extras.kpiWarnings.length > 0 ? { kpiWarnings: extras.kpiWarnings } : {}),
    ...(extras.defensiveWarnings && extras.defensiveWarnings.length > 0
      ? { defensiveWarnings: extras.defensiveWarnings }
      : {}),
    ...(extras.defensiveAudits && extras.defensiveAudits.length > 0
      ? { defensiveAudits: extras.defensiveAudits }
      : {}),
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
  const executorLogPath = resolveExecutorLogPath(root, options);

  const proof = evaluateGitProof(root, mission, options, executorLogPath);
  if (proof.kind === "fail") return proof.failure;
  const { proofMsnId, warnings: gitProofWarnings } = proof;

  if (options.prePush === true && isLegislativeStub(mission)) {
    return {
      ok: true,
      outcome: "pre_push_stub",
      proofMsnId,
      executorLogPath,
      traceWarnings: [],
      ...(gitProofWarnings.length > 0 ? { gitProofWarnings } : {}),
    };
  }

  const gate = mission.gate;
  if (!gate) {
    return {
      ok: false,
      phase: "gate",
      message: "Mission has no gate_command",
      exitCode: 1,
      executorLogPath,
    };
  }

  const virtualFlightId = beginVirtualCapture(root, mission);

  const gateOutcome = evaluateGatePhase(root, gate, options, executorLogPath);
  recordVirtualGateCapture(root, virtualFlightId, gate, gateOutcome.gateResult);

  if (gateOutcome.failure) return gateOutcome.failure;

  const postGate = collectDefensiveAndKpiOutcomes(root, manifest, mission, options, executorLogPath);
  if ("ok" in postGate && postGate.ok === false) return postGate;

  const trace = evaluateTracePhase(root, manifest, mission, options, executorLogPath);
  if (trace.kind === "fail") return trace.failure;

  if (virtualFlightId) {
    purgeVirtualFlightDir(root, virtualFlightId);
  }

  return buildFullVerifySuccess(proofMsnId, executorLogPath, trace, gitProofWarnings, postGate);
}
