import { logInfo } from "./cli-io.js";
import { teacherIdentitySetupHint } from "./teacher-identity.js";

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

export function hintTraceAmbiguous(workerLogPath: string, missionPath: string): string {
  return `disambiguate quotes in ${workerLogPath} or re-run: gapman runtime exec --mission ${missionPath} -- <worker>`;
}

export function hintTraceMissing(workerLogPath: string): string {
  return `append verbatim trace_quote to ${workerLogPath} from worker flight evidence`;
}

export function hintForbiddenZone(firstPath: string, missionPath: string): string {
  return `revert changes under ${firstPath}; stay inside GXT_TMVC_ROOTS — gapman runtime exec --mission ${missionPath}`;
}

export function hintRuntimeHumanSummary(summary: string, errorFile: string): string {
  return `${summary} See ${errorFile} (GXT_LAST_ERROR_FILE).`;
}
