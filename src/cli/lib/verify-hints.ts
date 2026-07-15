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
  parseMsnIdFromGitProofMessage,
} from "./fix-hints.js";
import type {
  DefensiveFailure,
  GateFailure,
  GitProofFailure,
  KpiFailure,
  KpiFailureKind,
  TraceFailure,
  TracePendingFailure,
  VerifyPhaseFailure,
} from "./verify-failure.js";

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

/** Mission/repo coordinates shared by every remediation, independent of the failing phase. */
export interface VerifyHintMeta {
  missionPath: string;
  root?: string;
  msnId?: string;
}

function tagStep(audience: OutputAudience, step: string): AudienceTaggedStep {
  return { audience, step };
}

function verifyCmd(mission: string): string {
  return `gantry verify --mission ${mission}`;
}

function hintsForGitProofPhase(failure: GitProofFailure, meta: VerifyHintMeta): VerifyRemediation {
  const mission = meta.missionPath;
  const verifyCmdStr = verifyCmd(mission);
  const code = parseGitProofCode(failure.gitProofMessage);
  const gitCtx = {
    root: meta.root,
    missionPath: mission,
    msnId: meta.msnId ?? parseMsnIdFromGitProofMessage(failure.gitProofMessage),
    repoRelMission: mission,
  };
  const hint = code ? hintGitProof(code, gitCtx) : verifyCmdStr;
  const nextActions =
    code === "NO_MSN_COMMITS" || code === "MISSION_FILE_NOT_MODIFIED_BY_PLANNER"
      ? [hint.split("; ")[0]!, 'gantry planner set "$(git config user.email)"', verifyCmdStr]
      : ['gantry planner set "$(git config user.email)"', verifyCmdStr];
  const tagged_steps: AudienceTaggedStep[] = [
    tagStep("planner", 'gantry planner set "$(git config user.email)"'),
    tagStep("verifier", verifyCmdStr),
  ];
  if (code === "NO_MSN_COMMITS" || code === "MISSION_FILE_NOT_MODIFIED_BY_PLANNER") {
    tagged_steps.unshift(tagStep("planner", nextActions[0]!));
  }
  return {
    error_code: code ? mapGitProofCodeToGxt(code) : GXT_ERROR.MISSION_UNSTAMPED,
    fix_hints: [hint],
    next_actions: nextActions,
    tagged_steps,
  };
}

function hintsForGatePhase(failure: GateFailure, meta: VerifyHintMeta): VerifyRemediation {
  const mission = meta.missionPath;
  const verifyCmdStr = verifyCmd(mission);
  const gate = failure.gateCommand ?? "<gate>";
  const combined = `${failure.gateStderr ?? ""}\n${failure.gateStdout ?? ""}`;
  const errorCode = gateOutputIndicatesImportLayer(failure.gateStdout ?? "")
    || gateOutputIndicatesImportLayer(failure.gateStderr ?? "")
    ? GXT_ERROR.IMPORT_LAYER_VIOLATION
    : gateOutputIndicatesBannedImport(combined)
      ? GXT_ERROR.BANNED_IMPORT_DETECTED
      : GXT_ERROR.GATE_FAILED;
  return {
    error_code: errorCode,
    fix_hints: [hintGate(gate, mission)],
    next_actions: [`re-run gate: ${gate}`, verifyCmdStr],
    tagged_steps: [
      tagStep("executor", `re-run gate: ${gate}`),
      tagStep("verifier", verifyCmdStr),
    ],
  };
}

function kpiErrorCodeForKind(kind: KpiFailureKind): GxtErrorCode {
  switch (kind) {
    case "missing":
      return GXT_ERROR.KPI_REPORT_MISSING;
    case "invalid":
      return GXT_ERROR.KPI_REPORT_INVALID;
    case "stale":
      return GXT_ERROR.KPI_REPORT_STALE;
    case "threshold":
    case "exit_code":
      return GXT_ERROR.KPI_GATE_FAILED;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function hintsForDefensivePhase(failure: DefensiveFailure, meta: VerifyHintMeta): VerifyRemediation {
  const verifyCmdStr = verifyCmd(meta.missionPath);
  return {
    error_code: GXT_ERROR.DEFENSIVE_GUARD_FAILED,
    fix_hints: [failure.defensiveReason, "reduce TMVC diff size or adjust defensive_profile.guards.net_loc_budget"],
    next_actions: [verifyCmdStr],
    tagged_steps: [tagStep("executor", "reduce diff churn in mission TMVC roots"), tagStep("verifier", verifyCmdStr)],
  };
}

function hintsForKpiPhase(failure: KpiFailure, meta: VerifyHintMeta): VerifyRemediation {
  const mission = meta.missionPath;
  const verifyCmdStr = verifyCmd(mission);
  return {
    error_code: kpiErrorCodeForKind(failure.kpiKind),
    fix_hints: [
      `gantry scan --mission ${mission}`,
      `commit updated KPI report under .gitagent/kpi/`,
      verifyCmdStr,
    ],
    next_actions: [`gantry scan --mission ${mission}`, verifyCmdStr],
    tagged_steps: [
      tagStep("executor", `gantry scan --mission ${mission}`),
      tagStep("verifier", verifyCmdStr),
    ],
  };
}

function hintsForTracePendingPhase(failure: TracePendingFailure, meta: VerifyHintMeta): VerifyRemediation {
  const mission = meta.missionPath;
  const steps = hintTracePendingSteps(failure.executorLogPath, mission, failure.gateCommand);
  return {
    error_code: GXT_ERROR.TRACE_PENDING,
    fix_hints: steps.slice(0, 3),
    next_actions: steps,
    tagged_steps: [
      tagStep("executor", steps[0]!),
      tagStep("executor", steps[1]!),
      tagStep("executor", steps[2]!),
      tagStep("verifier", steps[3] ?? verifyCmd(mission)),
    ],
  };
}

function hintsForTracePhase(failure: TraceFailure, meta: VerifyHintMeta): VerifyRemediation {
  const mission = meta.missionPath;
  const verifyCmdStr = verifyCmd(mission);
  const hints: string[] = [
    hintForTraceKind(failure.traceKind, failure.executorLogPath, mission, failure.traceQuote),
  ];
  const errorCode =
    failure.traceKind === "ambiguous"
      ? GXT_ERROR.TRACE_AMBIGUOUS
      : failure.traceKind === "stale_evidence"
        ? GXT_ERROR.TRACE_STALE
        : GXT_ERROR.TRACE_MISSING;
  return {
    error_code: errorCode,
    fix_hints: hints,
    next_actions: [verifyCmdStr, `gantry verify --mission ${mission} --fix`],
    tagged_steps: [
      tagStep("verifier", verifyCmdStr),
      tagStep("verifier", `gantry verify --mission ${mission} --fix`),
    ],
  };
}

export function hintsForVerifyPhase(
  failure: VerifyPhaseFailure,
  meta: VerifyHintMeta,
): VerifyRemediation {
  switch (failure.phase) {
    case "git_proof":
      return hintsForGitProofPhase(failure, meta);
    case "gate":
      return hintsForGatePhase(failure, meta);
    case "defensive":
      return hintsForDefensivePhase(failure, meta);
    case "kpi":
      return hintsForKpiPhase(failure, meta);
    case "trace_pending":
      return hintsForTracePendingPhase(failure, meta);
    case "trace":
      return hintsForTracePhase(failure, meta);
    default: {
      const _exhaustive: never = failure;
      return _exhaustive;
    }
  }
}
