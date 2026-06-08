import { logInfo } from "./cli-io.js";
import { GXT_ERROR, mapGitProofCodeToGxt, type GxtErrorCode } from "./gxt-error-codes.js";
import { teacherIdentitySetupHint } from "./teacher-identity.js";
import type { TraceFailureKind } from "./trace-failure-kind.js";

const REL_MISSIONS_PREFIX = ".gitagent/missions/";

/** Human remediation only — never mix with machine JSON streams. */
export function logFixHint(hint: string): void {
  logInfo(`Fix: ${hint}`);
}

export interface GitProofHintContext {
  root?: string;
  missionPath?: string;
  msnId?: string;
  repoRelMission?: string;
  latestAuthorEmail?: string;
  stampHash?: string;
  stampSubject?: string;
}

const GIT_PROOF_CODE_RE = /git-proof:\s*([A-Z_]+)\s*—/;

export function parseGitProofCode(message: string): string | null {
  const m = GIT_PROOF_CODE_RE.exec(message);
  return m?.[1] ?? null;
}

function parseMsnIdFromGitProofMessage(message: string): string | undefined {
  const m = message.match(/\[(MSN-\d{4})\]/);
  return m?.[1];
}

export function hintGitProofFromMessage(message: string): string | undefined {
  const code = parseGitProofCode(message);
  if (!code) return undefined;
  return hintGitProof(code, { msnId: parseMsnIdFromGitProofMessage(message) });
}

export function hintMissionNoGate(missionPath: string): string {
  return [
    `add gate_command (YAML) or a Command row (markdown) to ${missionPath}`,
    "see .gitagent/missions/example.verify.yaml for a working verify mission",
  ].join("; ");
}

export function hintGitProof(code: string, ctx: GitProofHintContext): string {
  const mission = ctx.missionPath ?? "<mission>";
  const verifyCmd = `gapman verify --mission ${mission}`;
  const root = ctx.root ?? ".";

  switch (code) {
    case "MISSION_MISSING_MSN":
      return [
        "add msn_id / msnId (YAML), line-start [MSN-NNNN], or # Mission: MSN-NNNN",
        "see .gitagent/missions/example.verify.yaml",
        verifyCmd,
      ].join("; ");
    case "TEACHER_IDENTITY_UNCONFIGURED":
      return hintTeacherEmails(root);
    case "NO_MSN_COMMITS": {
      const msn = ctx.msnId ?? "MSN-NNNN";
      return [
        `git add ${mission} && git commit -m "[${msn}] legislate mission"`,
        `gapman teacher set "$(git config user.email)"`,
        verifyCmd,
      ].join("; ");
    }
    case "NO_TEACHER_MSN_COMMIT": {
      const email = ctx.latestAuthorEmail ?? "$(git log -1 --format=%ae)";
      return [
        `gapman teacher set "${email}"`,
        "add each Teacher email allowed to legislate in this repo",
        verifyCmd,
      ].join("; ");
    }
    case "MISSION_FILE_NOT_MODIFIED_BY_TEACHER": {
      const msn = ctx.msnId ?? "MSN-NNNN";
      const rel = ctx.repoRelMission ?? mission;
      return [
        `git add ${rel} && git commit -m "[${msn}] include mission in Teacher stamp"`,
        verifyCmd,
      ].join("; ");
    }
    case "MISSION_OUTSIDE_MISSIONS_DIR":
      return `move mission under ${REL_MISSIONS_PREFIX} (got path outside missions dir)`;
    case "MISSION_NO_GATE":
      return hintMissionNoGate(mission);
    default:
      return verifyCmd;
  }
}

export function hintTeacherEmails(repoRoot: string): string {
  return teacherIdentitySetupHint(repoRoot);
}

export function hintGate(command: string, missionPath: string): string {
  return `re-run gate: ${command}  # then gapman verify --mission ${missionPath}`;
}

export function hintTraceStrictTrace(missionPath: string): string {
  return `remove --strict-trace to allow auto line-drift resolution: gapman verify --mission ${missionPath}`;
}

export function hintTraceAmbiguous(
  workerLogPath: string,
  missionPath: string,
  traceQuote?: string,
): string {
  if (traceQuote !== undefined && traceQuote.trim().length <= 12) {
    return `trace_quote "${traceQuote.trim()}" matches multiple lines in ${workerLogPath} — append a unique mission-specific line (e.g. "- DoD 1: MSN-… gate passed") and set trace_quote to that full verbatim line in ${missionPath}`;
  }
  return `disambiguate quotes in ${workerLogPath} or re-run: gapman runtime exec --mission ${missionPath} -- <worker>`;
}

export function hintTraceMissing(workerLogPath: string): string {
  return `append verbatim trace_quote to ${workerLogPath} from worker flight evidence`;
}

export function hintTraceStaleEvidence(workerLogPath: string, missionPath: string): string {
  return [
    `TMVC drift since WORKER_LOG trace attestation — re-run gate (${missionPath})`,
    `append a fresh unique trace line to ${workerLogPath} and set mission trace_quote to that verbatim line`,
    "after interactive rebase/squash, re-run gate + verify (historical attestation may be invalidated)",
  ].join("; ");
}

/** Mission still has legislate stub placeholder in trace_quote (status may already be PASS). */
export function hintTraceQuoteStillPlaceholder(
  missionPath: string,
  workerLogPath: string,
): string {
  return `edit ${missionPath}: replace trace_quote placeholder with a verbatim substring from ${workerLogPath} (not the other way around)`;
}

/** Worker loop after Teacher legislation — trace rows still PENDING. */
export function hintTracePendingSteps(
  workerLogPath: string,
  missionPath: string,
  gateCommand?: string,
): string[] {
  const verifyCmd = `gapman verify --mission ${missionPath}`;
  const steps = [
    `eval "$(gapman runtime env --mission ${missionPath})" then execute worker within TMVC`,
    gateCommand
      ? `run gate (${gateCommand}); append a unique mission-specific line to ${workerLogPath} (not bare gate output if "OK" appears elsewhere)`
      : `append a unique mission-specific evidence line to ${workerLogPath}`,
    `edit ${missionPath}: set trace row status PASS and trace_quote to verbatim substring from ${workerLogPath}`,
    verifyCmd,
  ];
  return steps;
}

export function hintForbiddenZone(firstPath: string, missionPath: string): string {
  return `revert changes under ${firstPath}; stay inside GXT_TMVC_ROOTS — gapman runtime exec --mission ${missionPath}`;
}

export function hintRuntimeHumanSummary(summary: string, errorFile: string): string {
  return `${summary} See ${errorFile} (GXT_LAST_ERROR_FILE).`;
}

export type VerifyPhase = "git_proof" | "gate" | "trace" | "trace_pending";

export interface VerifyHintContext {
  root?: string;
  missionPath: string;
  msnId?: string;
  workerLogPath?: string;
  gateCommand?: string;
  gitProofMessage?: string;
  strictTrace?: boolean;
  /** Typed trace failure — preferred over traceFailureReason for control flow. */
  traceKind?: TraceFailureKind;
  /** When set and still the legislate placeholder, emit targeted hint. */
  traceQuote?: string;
  /** Legacy string reason — use traceKind when available. */
  traceFailureReason?: string;
}

export function hintsForVerifyPhase(phase: VerifyPhase, ctx: VerifyHintContext): {
  error_code: GxtErrorCode;
  fix_hints: string[];
  next_actions: string[];
} {
  switch (phase) {
    case "git_proof":
      return hintsForGitProofPhase(ctx);
    case "gate":
      return hintsForGatePhase(ctx);
    case "trace_pending":
      return hintsForTracePendingPhase(ctx);
    case "trace":
      return hintsForTracePhase(ctx);
  }
}

function hintsForGitProofPhase(ctx: VerifyHintContext): {
  error_code: GxtErrorCode;
  fix_hints: string[];
  next_actions: string[];
} {
  const mission = ctx.missionPath;
  const verifyCmd = `gapman verify --mission ${mission}`;
  const code = parseGitProofCode(ctx.gitProofMessage ?? "");
  const gitCtx = {
    root: ctx.root,
    missionPath: mission,
    msnId: ctx.msnId ?? parseMsnIdFromGitProofMessage(ctx.gitProofMessage ?? ""),
    repoRelMission: mission,
  };
  const hint = code ? hintGitProof(code, gitCtx) : verifyCmd;
  const nextActions =
    code === "NO_MSN_COMMITS" || code === "MISSION_FILE_NOT_MODIFIED_BY_TEACHER"
      ? [hint.split("; ")[0]!, "gapman teacher set \"$(git config user.email)\"", verifyCmd]
      : ["gapman teacher set \"$(git config user.email)\"", verifyCmd];
  return {
    error_code: code ? mapGitProofCodeToGxt(code) : GXT_ERROR.MISSION_UNSTAMPED,
    fix_hints: [hint],
    next_actions: nextActions,
  };
}

function hintsForGatePhase(ctx: VerifyHintContext): {
  error_code: GxtErrorCode;
  fix_hints: string[];
  next_actions: string[];
} {
  const mission = ctx.missionPath;
  const verifyCmd = `gapman verify --mission ${mission}`;
  const gate = ctx.gateCommand ?? "<gate>";
  return {
    error_code: GXT_ERROR.GATE_FAILED,
    fix_hints: [hintGate(gate, mission)],
    next_actions: [`re-run gate: ${gate}`, verifyCmd],
  };
}

function hintsForTracePendingPhase(ctx: VerifyHintContext): {
  error_code: GxtErrorCode;
  fix_hints: string[];
  next_actions: string[];
} {
  const mission = ctx.missionPath;
  const workerLog = ctx.workerLogPath ?? "WORKER_LOG.md";
  const steps = hintTracePendingSteps(workerLog, mission, ctx.gateCommand);
  return {
    error_code: GXT_ERROR.TRACE_PENDING,
    fix_hints: steps.slice(0, 3),
    next_actions: steps,
  };
}

function hintsForTracePhase(ctx: VerifyHintContext): {
  error_code: GxtErrorCode;
  fix_hints: string[];
  next_actions: string[];
} {
  const mission = ctx.missionPath;
  const workerLog = ctx.workerLogPath ?? "WORKER_LOG.md";
  const verifyCmd = `gapman verify --mission ${mission}`;
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
    next_actions: [verifyCmd, `gapman verify --mission ${mission} --fix`],
  };
}

export function hintForTraceKind(
  traceKind: TraceFailureKind,
  workerLog: string,
  mission: string,
  traceQuote?: string,
): string {
  switch (traceKind) {
    case "ambiguous":
      return hintTraceAmbiguous(workerLog, mission, traceQuote);
    case "placeholder_quote":
      return hintTraceQuoteStillPlaceholder(mission, workerLog);
    case "strict_line_drift":
      return hintTraceStrictTrace(mission);
    case "stale_evidence":
      return hintTraceStaleEvidence(workerLog, mission);
    case "quote_missing":
    case "worker_log_missing":
    case "empty_quote":
    case "anchor_mismatch":
    case "other":
      return hintTraceMissing(workerLog);
  }
}
