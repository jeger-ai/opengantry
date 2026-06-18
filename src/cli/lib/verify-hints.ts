import type { OutputAudience } from "./audience-output.js";
import type { GxtErrorCode } from "./gxt-error-codes.js";
import { GXT_ERROR, mapGitProofCodeToGxt } from "./gxt-error-codes.js";
import { gateOutputIndicatesBannedImport } from "./banned-import-violation.js";
import { gateOutputIndicatesImportLayer } from "./surgeon.js";
import {
  hintForTraceKind,
  hintGate,
  hintGitProof,
  hintTracePendingSteps,
  parseGitProofCode,
} from "./fix-hints.js";
import type { TraceFailureKind } from "./trace.js";
import type { VerifyFailurePhase, VerifyOptions, VerifyPhaseFailure } from "./verify-engine.js";

export interface AudienceTaggedStep {
  audience: OutputAudience;
  step: string;
}

export interface VerifyRemediation {
  error_code: GxtErrorCode;
  fix_hints: string[];
  next_actions: string[];
  tagged_steps?: AudienceTaggedStep[];
}

export interface VerifyHintContext {
  root?: string;
  missionPath: string;
  msnId?: string;
  workerLogPath?: string;
  gateCommand?: string;
  gitProofMessage?: string;
  strictTrace?: boolean;
  traceKind?: TraceFailureKind;
  traceQuote?: string;
  traceFailureReason?: string;
  kpiFailureReason?: string;
  gateStderr?: string;
  gateStdout?: string;
}

export function buildVerifyHintContext(
  failure: VerifyPhaseFailure,
  missionArg: string,
  options: Pick<VerifyOptions, "strictTrace">,
  root?: string,
  msnId?: string,
): VerifyHintContext {
  return {
    root,
    missionPath: missionArg,
    msnId,
    workerLogPath: failure.workerLogPath,
    gateCommand: failure.gateCommand,
    gitProofMessage: failure.gitProofMessage ?? failure.message,
    traceKind: failure.traceKind,
    traceQuote: failure.traceQuote,
    traceFailureReason: failure.traceReason,
    kpiFailureReason: failure.kpiReason ?? failure.message,
    gateStderr: failure.gateStderr,
    gateStdout: failure.gateStdout,
    strictTrace: options.strictTrace,
  };
}

function parseMsnIdFromGitProofMessage(message: string): string | undefined {
  const m = message.match(/\[(MSN-\d{4})\]/);
  return m?.[1];
}

function tagStep(audience: OutputAudience, step: string): AudienceTaggedStep {
  return { audience, step };
}

function verifyCmd(mission: string): string {
  return `gapman verify --mission ${mission}`;
}

function hintsForGitProofPhase(ctx: VerifyHintContext): VerifyRemediation {
  const mission = ctx.missionPath;
  const verifyCmdStr = verifyCmd(mission);
  const code = parseGitProofCode(ctx.gitProofMessage ?? "");
  const gitCtx = {
    root: ctx.root,
    missionPath: mission,
    msnId: ctx.msnId ?? parseMsnIdFromGitProofMessage(ctx.gitProofMessage ?? ""),
    repoRelMission: mission,
  };
  const hint = code ? hintGitProof(code, gitCtx) : verifyCmdStr;
  const nextActions =
    code === "NO_MSN_COMMITS" || code === "MISSION_FILE_NOT_MODIFIED_BY_TEACHER"
      ? [hint.split("; ")[0]!, 'gapman teacher set "$(git config user.email)"', verifyCmdStr]
      : ['gapman teacher set "$(git config user.email)"', verifyCmdStr];
  const tagged_steps: AudienceTaggedStep[] = [
    tagStep("teacher", 'gapman teacher set "$(git config user.email)"'),
    tagStep("verifier", verifyCmdStr),
  ];
  if (code === "NO_MSN_COMMITS" || code === "MISSION_FILE_NOT_MODIFIED_BY_TEACHER") {
    tagged_steps.unshift(tagStep("teacher", nextActions[0]!));
  }
  return {
    error_code: code ? mapGitProofCodeToGxt(code) : GXT_ERROR.MISSION_UNSTAMPED,
    fix_hints: [hint],
    next_actions: nextActions,
    tagged_steps,
  };
}

function hintsForGatePhase(ctx: VerifyHintContext): VerifyRemediation {
  const mission = ctx.missionPath;
  const verifyCmdStr = verifyCmd(mission);
  const gate = ctx.gateCommand ?? "<gate>";
  const combined = `${ctx.gateStderr ?? ""}\n${ctx.gateStdout ?? ""}`;
  const errorCode = gateOutputIndicatesImportLayer(ctx.gateStdout ?? "")
    || gateOutputIndicatesImportLayer(ctx.gateStderr ?? "")
    ? GXT_ERROR.IMPORT_LAYER_VIOLATION
    : gateOutputIndicatesBannedImport(combined)
      ? GXT_ERROR.BANNED_IMPORT_DETECTED
      : GXT_ERROR.GATE_FAILED;
  return {
    error_code: errorCode,
    fix_hints: [hintGate(gate, mission)],
    next_actions: [`re-run gate: ${gate}`, verifyCmdStr],
    tagged_steps: [
      tagStep("worker", `re-run gate: ${gate}`),
      tagStep("verifier", verifyCmdStr),
    ],
  };
}

function hintsForKpiPhase(ctx: VerifyHintContext): VerifyRemediation {
  const mission = ctx.missionPath;
  const verifyCmdStr = verifyCmd(mission);
  const reason = ctx.kpiFailureReason ?? "";
  const errorCode = reason.includes("missing")
    ? GXT_ERROR.KPI_REPORT_MISSING
    : reason.includes("invalid") || reason.includes("schema")
      ? GXT_ERROR.KPI_REPORT_INVALID
      : reason.includes("STALE") || reason.includes("stale")
        ? GXT_ERROR.KPI_REPORT_STALE
        : GXT_ERROR.KPI_GATE_FAILED;
  return {
    error_code: errorCode,
    fix_hints: [
      `gapman scan --mission ${mission}`,
      `commit updated KPI report under .gitagent/kpi/`,
      verifyCmdStr,
    ],
    next_actions: [`gapman scan --mission ${mission}`, verifyCmdStr],
    tagged_steps: [
      tagStep("worker", `gapman scan --mission ${mission}`),
      tagStep("verifier", verifyCmdStr),
    ],
  };
}

function hintsForTracePendingPhase(ctx: VerifyHintContext): VerifyRemediation {
  const mission = ctx.missionPath;
  const workerLog = ctx.workerLogPath ?? "WORKER_LOG.md";
  const steps = hintTracePendingSteps(workerLog, mission, ctx.gateCommand);
  return {
    error_code: GXT_ERROR.TRACE_PENDING,
    fix_hints: steps.slice(0, 3),
    next_actions: steps,
    tagged_steps: [
      tagStep("worker", steps[0]!),
      tagStep("worker", steps[1]!),
      tagStep("worker", steps[2]!),
      tagStep("verifier", steps[3] ?? verifyCmd(mission)),
    ],
  };
}

function hintsForTracePhase(ctx: VerifyHintContext): VerifyRemediation {
  const mission = ctx.missionPath;
  const workerLog = ctx.workerLogPath ?? "WORKER_LOG.md";
  const verifyCmdStr = verifyCmd(mission);
  const traceKind = ctx.traceKind ?? "other";
  const hints: string[] = [hintForTraceKind(traceKind, workerLog, mission, ctx.traceQuote)];
  const errorCode =
    traceKind === "ambiguous"
      ? GXT_ERROR.TRACE_AMBIGUOUS
      : traceKind === "stale_evidence"
        ? GXT_ERROR.TRACE_STALE
        : GXT_ERROR.TRACE_MISSING;
  return {
    error_code: errorCode,
    fix_hints: hints,
    next_actions: [verifyCmdStr, `gapman verify --mission ${mission} --fix`],
    tagged_steps: [
      tagStep("verifier", verifyCmdStr),
      tagStep("verifier", `gapman verify --mission ${mission} --fix`),
    ],
  };
}

export function hintsForVerifyPhase(
  phase: VerifyFailurePhase,
  ctx: VerifyHintContext,
): VerifyRemediation {
  switch (phase) {
    case "git_proof":
      return hintsForGitProofPhase(ctx);
    case "gate":
      return hintsForGatePhase(ctx);
    case "kpi":
      return hintsForKpiPhase(ctx);
    case "trace_pending":
      return hintsForTracePendingPhase(ctx);
    case "trace":
      return hintsForTracePhase(ctx);
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}
