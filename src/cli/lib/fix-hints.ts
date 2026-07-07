import { logInfo } from "./cli-io.js";
import { plannerIdentitySetupHint } from "./planner-identity.js";
import type { TraceFailureKind } from "./trace.js";

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

export function parseMsnIdFromGitProofMessage(message: string): string | undefined {
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
  const verifyCmd = `gantry verify --mission ${mission}`;
  const root = ctx.root ?? ".";

  switch (code) {
    case "MISSION_MISSING_MSN":
      return [
        "add msn_id / msnId (YAML), line-start [MSN-NNNN], or # Mission: MSN-NNNN",
        "see .gitagent/missions/example.verify.yaml",
        verifyCmd,
      ].join("; ");
    case "PLANNER_IDENTITY_UNCONFIGURED":
      return hintTeacherEmails(root);
    case "NO_MSN_COMMITS": {
      const msn = ctx.msnId ?? "MSN-NNNN";
      return [
        `git add ${mission} && git commit -m "[${msn}] legislate mission"`,
        `gantry planner set "$(git config user.email)"`,
        verifyCmd,
      ].join("; ");
    }
    case "NO_PLANNER_MSN_COMMIT": {
      const email = ctx.latestAuthorEmail ?? "$(git log -1 --format=%ae)";
      return [
        `gantry planner set "${email}"`,
        "add each Planner email allowed to legislate in this repo",
        verifyCmd,
      ].join("; ");
    }
    case "MISSION_FILE_NOT_MODIFIED_BY_PLANNER": {
      const msn = ctx.msnId ?? "MSN-NNNN";
      const rel = ctx.repoRelMission ?? mission;
      return [
        `git add ${rel} && git commit -m "[${msn}] include mission in Planner stamp"`,
        verifyCmd,
      ].join("; ");
    }
    case "MISSION_OUTSIDE_MISSIONS_DIR":
      return `move mission under ${REL_MISSIONS_PREFIX} (got path outside missions dir)`;
    case "MISSION_NO_GATE":
      return hintMissionNoGate(mission);
    case "PLANNER_STAMP_UNSIGNED":
      return [
        "enable commit signing for Planner legislation (git config commit.gpgsign true or SSH signing)",
        "or set planner_signature to off or warn in .gitagent/config.json",
        verifyCmd,
      ].join("; ");
    default:
      return verifyCmd;
  }
}

export function hintTeacherEmails(repoRoot: string): string {
  return plannerIdentitySetupHint(repoRoot);
}

export function hintGate(command: string, missionPath: string): string {
  return `re-run gate: ${command}  # then gantry verify --mission ${missionPath}`;
}

export function hintTraceStrictTrace(missionPath: string): string {
  return `remove --strict-trace to allow auto line-drift resolution: gantry verify --mission ${missionPath}`;
}

export function hintTraceAmbiguous(
  executorLogPath: string,
  missionPath: string,
  traceQuote?: string,
): string {
  if (traceQuote !== undefined && traceQuote.trim().length <= 12) {
    return `trace_quote "${traceQuote.trim()}" matches multiple lines in ${executorLogPath} — append a unique mission-specific line (e.g. "- DoD 1: MSN-… gate passed") and set trace_quote to that full verbatim line in ${missionPath}`;
  }
  return `disambiguate quotes in ${executorLogPath} or re-run: gantry runtime exec --mission ${missionPath} -- <worker>`;
}

export function hintTraceMissing(executorLogPath: string): string {
  return `append verbatim trace_quote to ${executorLogPath} from executor flight evidence`;
}

export function hintTraceStaleEvidence(executorLogPath: string, missionPath: string): string {
  return [
    `TMVC drift since EXECUTOR_LOG trace attestation — re-run gate (${missionPath})`,
    `append a fresh unique trace line to ${executorLogPath} and set mission trace_quote to that verbatim line`,
    "after interactive rebase/squash, re-run gate + verify (historical attestation may be invalidated)",
  ].join("; ");
}

export function hintTraceQuoteStillPlaceholder(
  missionPath: string,
  executorLogPath: string,
): string {
  return `edit ${missionPath}: replace trace_quote placeholder with a verbatim substring from ${executorLogPath} (not the other way around)`;
}

export function hintTracePendingSteps(
  executorLogPath: string,
  missionPath: string,
  gateCommand?: string,
): string[] {
  const verifyCmd = `gantry verify --mission ${missionPath}`;
  return [
    `eval "$(gantry runtime env --mission ${missionPath})" then execute executor within TMVC`,
    gateCommand
      ? `run gate (${gateCommand}); append a unique mission-specific line to ${executorLogPath} (not bare gate output if "OK" appears elsewhere)`
      : `append a unique mission-specific evidence line to ${executorLogPath}`,
    `edit ${missionPath}: set trace row status PASS and trace_quote to verbatim substring from ${executorLogPath}`,
    verifyCmd,
  ];
}

export function hintForbiddenZone(firstPath: string, missionPath: string): string {
  return `revert changes under ${firstPath}; stay inside GXT_TMVC_ROOTS — gantry runtime exec --mission ${missionPath}`;
}

export function hintRuntimeHumanSummary(summary: string, errorFile: string): string {
  return `${summary} See ${errorFile} (GXT_LAST_ERROR_FILE).`;
}

export function hintForTraceKind(
  traceKind: TraceFailureKind,
  executorLog: string,
  mission: string,
  traceQuote?: string,
): string {
  switch (traceKind) {
    case "ambiguous":
      return hintTraceAmbiguous(executorLog, mission, traceQuote);
    case "placeholder_quote":
      return hintTraceQuoteStillPlaceholder(mission, executorLog);
    case "strict_line_drift":
      return hintTraceStrictTrace(mission);
    case "stale_evidence":
      return hintTraceStaleEvidence(executorLog, mission);
    case "quote_missing":
    case "executor_log_missing":
    case "empty_quote":
    case "anchor_mismatch":
    case "other":
      return hintTraceMissing(executorLog);
  }
}
