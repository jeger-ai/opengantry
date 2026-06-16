import { runLegislate } from "./legislate-core.js";
import { CLI_NAME } from "./constants.js";
import { logError, logInfo, logWarn, setExitCode } from "./cli-io.js";
import { allocateMsn } from "./msn-allocate.js";
import { isValidMsnId } from "./mission-msn.js";
import { isTriageEscalated } from "./legislate-skill.js";
import { formatTriageHuman, triageIntent } from "./triage-logic.js";
import type { TriageResult } from "./types.js";
import {
  audienceSectionTitle,
  filterNextStepsForAudience,
  formatAudienceNextStep,
  type OutputAudience,
} from "./audience-output.js";
import { getOutputAudience } from "./output-context.js";
import { loadWorkspace } from "./workspace.js";

export interface StartOptions {
  intent: string;
  msn?: string;
  skillKey?: string;
  gateCommand?: string;
  gateSuccessSubstring?: string;
  writeMission?: boolean;
  allowDuplicate?: boolean;
  json?: boolean;
  /** When true, suppress stdout info/warn (MCP and --json callers). */
  silent?: boolean;
  audience?: OutputAudience;
}

export interface StartResult {
  ok: boolean;
  triage: TriageResult;
  triage_action: string;
  skill_key: string;
  msn_id: string | null;
  mission_file_path: string | null;
  next_steps: string[];
  exit_code: number;
}

function suppressStartOutput(options: StartOptions): boolean {
  return options.silent === true || options.json === true;
}

function suggestNextMsn(root: string): string {
  return allocateMsn(root, { band: "work" });
}

function buildNextSteps(missionRel: string | null, msnId: string | null): string[] {
  const mission = missionRel ?? ".gitagent/missions/<file>.yaml";
  const msn = msnId ?? "MSN-NNNN";
  return [
    `Teacher: git add ${mission} && git commit -m "[${msn}] legislate mission"`,
    `eval "$(gapman runtime env --mission ${mission})"`,
    "Append gate evidence to WORKER_LOG.md",
    `gapman verify --mission ${mission}`,
    `scripts/gxt-pin-mission.sh ${mission}`,
  ];
}

function logStartTriage(
  options: StartOptions,
  triage: TriageResult,
  escalated: boolean,
  skillOverride: string | undefined,
): void {
  if (suppressStartOutput(options)) return;
  if (!escalated) {
    logInfo(formatTriageHuman(triage));
    return;
  }
  if (skillOverride) {
    return;
  }
  logInfo(formatTriageHuman(triage));
}

function startEscalationFailure(
  options: StartOptions,
  triage: TriageResult,
  msnId: string,
  manifestKeys: string[],
): StartResult {
  if (!suppressStartOutput(options)) {
    logError(
      `${CLI_NAME} start: triage escalation — ${triage.reason}. Pass --skill-key <key> (manifest: ${manifestKeys.join(", ")}).`,
    );
  }
  return {
    ok: false,
    triage,
    triage_action: triage.action,
    skill_key: triage.skill_key,
    msn_id: null,
    mission_file_path: null,
    next_steps: [
      `gapman start "${options.intent}" --msn ${msnId} --skill-key ${manifestKeys[0] ?? "<key>"}`,
    ],
    exit_code: 2,
  };
}

function scaffoldStartMission(
  root: string,
  options: StartOptions,
  msnId: string,
  resolvedSkillKey: string,
  triage: TriageResult,
): StartResult | { missionRel: string } {
  const quiet = suppressStartOutput(options);
  if (options.writeMission === false) {
    if (!quiet) {
      logWarn(`${CLI_NAME} start: --no-write — run legislate manually with --msn ${msnId}`);
    }
    return { missionRel: `.gitagent/missions/${msnId}.<slug>.yaml` };
  }

  const result = runLegislate({
    intent: options.intent,
    msn: msnId,
    skillKey: resolvedSkillKey,
    gateCommand: options.gateCommand,
    gateSuccessSubstring: options.gateSuccessSubstring,
    allowDuplicate: options.allowDuplicate,
    silent: quiet,
  });

  if (result.ok) {
    if (!quiet) {
      logInfo(`${CLI_NAME} start: mission scaffold at ${result.missionRel}`);
    }
    return { missionRel: result.missionRel };
  }

  const freshMsn = suggestNextMsn(root);
  return {
    ok: false,
    triage,
    triage_action: triage.action,
    skill_key: resolvedSkillKey,
    msn_id: msnId,
    mission_file_path: null,
    next_steps: [
      `try a fresh MSN: gapman start "${options.intent}" --msn ${freshMsn} --skill-key ${resolvedSkillKey}`,
      `or gapman legislate "${options.intent}" --msn ${msnId} --skill-key ${resolvedSkillKey} --allow-duplicate`,
    ],
    exit_code: 2,
  };
}

export function runStartOrchestration(options: StartOptions): StartResult {
  const { root, manifest } = loadWorkspace();
  const triage = triageIntent(root, options.intent, manifest);
  const msnId = options.msn?.trim() || suggestNextMsn(root);
  const skillOverride = options.skillKey?.trim();
  const escalated = isTriageEscalated(triage);
  const manifestKeys = Object.keys(manifest.skills);

  logStartTriage(options, triage, escalated, skillOverride);

  if (escalated && !skillOverride) {
    return startEscalationFailure(options, triage, msnId, manifestKeys);
  }
  if (escalated && skillOverride && !suppressStartOutput(options)) {
    logWarn(`${CLI_NAME} start: triage escalated; using --skill-key ${skillOverride}`);
  }

  const resolvedSkillKey = skillOverride || triage.skill_key;
  if (!isValidMsnId(msnId)) {
    if (!suppressStartOutput(options)) {
      logError(`${CLI_NAME} start: --msn must match MSN-0007`);
    }
    return {
      ok: false,
      triage,
      triage_action: triage.action,
      skill_key: triage.skill_key,
      msn_id: null,
      mission_file_path: null,
      next_steps: [],
      exit_code: 2,
    };
  }

  const scaffold = scaffoldStartMission(root, options, msnId, resolvedSkillKey, triage);
  if ("ok" in scaffold) return scaffold;

  const audience = options.audience ?? getOutputAudience();
  const nextSteps = buildNextSteps(scaffold.missionRel, msnId);
  const filtered = filterNextStepsForAudience(audience, nextSteps).map((step) =>
    formatAudienceNextStep(step, audience),
  );
  const section = audienceSectionTitle(audience);

  if (!suppressStartOutput(options)) {
    logInfo("next steps:");
    if (section) logInfo(`${section}:`);
    for (const step of filtered) logInfo(`  ${step}`);
  }

  return {
    ok: true,
    triage,
    triage_action: triage.action,
    skill_key: resolvedSkillKey,
    msn_id: msnId,
    mission_file_path: scaffold.missionRel,
    next_steps: filtered,
    exit_code: 0,
  };
}

export function formatStartJson(result: StartResult): string {
  return JSON.stringify(
    {
      status: result.ok ? "ok" : "failed",
      triage: result.triage,
      triage_action: result.triage_action,
      skill_key: result.skill_key,
      msn_id: result.msn_id,
      mission_file_path: result.mission_file_path,
      next_steps: result.next_steps,
      exit_code: result.exit_code,
    },
    null,
    2,
  );
}

export function runStart(options: StartOptions): void {
  const orchestrationOpts: StartOptions = options.json
    ? { ...options, silent: true }
    : options;
  const result = runStartOrchestration(orchestrationOpts);
  if (options.json) {
    logInfo(formatStartJson(result));
    if (result.exit_code !== 0) setExitCode(result.exit_code);
    return;
  }
  if (result.exit_code !== 0) setExitCode(result.exit_code);
}
