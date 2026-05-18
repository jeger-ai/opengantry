import { logInfo } from "./cli-io.js";

/** Human remediation only — never mix with machine JSON streams. */
export function logFixHint(hint: string): void {
  logInfo(`Fix: ${hint}`);
}

export function hintTeacherEmails(repoRoot: string): string {
  return [
    'export GAPMAN_TEACHER_EMAILS="$(git log -1 --format=%ae)"',
    `gapman verify --mission <mission>  # from ${repoRoot}`,
  ].join("\n       ");
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
