import { logError, logInfo, logWarn, setExitCode } from "../lib/cli-io.js";
import {
  audienceSectionTitle,
  filterNextStepsForAudience,
  type OutputAudience,
} from "../lib/audience-output.js";
import { buildStatusReport, type StatusReport } from "../lib/status-report.js";
import type { SkillSyncResult } from "../lib/skill-sync.js";
import { loadWorkspaceWithSkillSync } from "../lib/workspace.js";

export interface StatusOptions {
  json?: boolean;
  verbose?: boolean;
  audience?: OutputAudience;
}

function logStatusSummary(report: StatusReport): void {
  logInfo(`repo: ${report.repo}`);
  logInfo(`schema_version: ${report.schema_version}`);
  logInfo(`manifest skills: ${report.manifest_skills.join(", ") || "(none)"}`);
  logInfo(`skills/*.md: ${report.skills_md.join(", ") || "(none)"}`);
  logInfo(`pinned mission: ${report.pinned_mission ?? "(none)"}`);
  logInfo(`verify readiness: ${report.verify_readiness}`);
  logInfo(`readiness summary: ${report.readiness_summary}`);
  if (report.blockers.length > 0) {
    logWarn(`blockers (${report.blockers.length}):`);
    for (const blocker of report.blockers) logWarn(`  - ${blocker}`);
  }
  if (report.last_error_file) {
    logWarn(`last runtime error file: ${report.last_error_file}`);
  }
}

function logStatusChecks(
  report: StatusReport,
  skillSync: SkillSyncResult,
  verbose: boolean,
): void {
  if (verbose) {
    for (const line of report.doctor_lines) {
      logInfo(`${line.level}: ${line.message}`);
    }
    return;
  }
  for (const w of skillSync.warnings) logWarn(w);
  for (const e of skillSync.errors) logError(`status: ${e}`);
}

function logStatusNextSteps(report: StatusReport, audience: OutputAudience | undefined): void {
  const section = audienceSectionTitle(audience);
  const nextSteps = filterNextStepsForAudience(
    audience,
    report.next_step ? [report.next_step] : [],
  );
  if (section && nextSteps.length > 0) {
    logInfo(`${section}:`);
    for (const step of nextSteps) logInfo(`  ${step}`);
    return;
  }
  if (report.next_step) logInfo(`Next: ${report.next_step}`);
}

function finishStatusRun(report: StatusReport): void {
  logInfo(report.skill_sync_ok && report.exit_code === 0 ? "status: OK" : "status: FAILED");
  if (report.exit_code !== 0) setExitCode(report.exit_code);
}

export function runStatus(options: StatusOptions = {}): void {
  const { root, manifest, skillSync } = loadWorkspaceWithSkillSync();
  const report = buildStatusReport(root, manifest);

  if (options.json) {
    logInfo(JSON.stringify(report, null, 2));
    if (report.exit_code !== 0) setExitCode(report.exit_code);
    return;
  }

  logStatusSummary(report);
  logStatusChecks(report, skillSync, options.verbose === true);
  logStatusNextSteps(report, options.audience);
  finishStatusRun(report);
}
