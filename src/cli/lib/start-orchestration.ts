import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runLegislate, isTriageEscalated } from "./legislate.js";
import { CLI_NAME, REL_HISTORY_DIR, REL_MANIFEST } from "./constants.js";
import { logError, logInfo, logWarn, setExitCode } from "./cli-io.js";
import { allocateMsn } from "./msn-allocate.js";
import { isValidMsnId } from "./missions/parser.js";
import { formatTriageHuman, triageIntent } from "./triage-logic.js";
import type { Manifest, TriageResult } from "./types.js";
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
  if (escalated && skillOverride) return;
  logInfo(formatTriageHuman(triage));
}

type StartFailureResult = StartResult & { ok: false };

function createStartFailure(
  triage: TriageResult,
  msnId: string | null,
  skillKey: string,
  nextSteps: string[],
): StartFailureResult {
  return {
    ok: false,
    triage,
    triage_action: triage.action,
    skill_key: skillKey,
    msn_id: msnId,
    mission_file_path: null,
    next_steps: nextSteps,
    exit_code: 2,
  };
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
  return createStartFailure(triage, null, triage.skill_key, [
    `gapman start "${options.intent}" --msn ${msnId} --skill-key ${manifestKeys[0] ?? "<key>"}`,
  ]);
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
  return createStartFailure(triage, msnId, resolvedSkillKey, [
    `try a fresh MSN: gapman start "${options.intent}" --msn ${freshMsn} --skill-key ${resolvedSkillKey}`,
    `or gapman legislate "${options.intent}" --msn ${msnId} --skill-key ${resolvedSkillKey} --allow-duplicate`,
  ]);
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
    return createStartFailure(triage, null, triage.skill_key, []);
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

export interface StartStateSnapshot {
  captured_at: string;
  head_sha: string;
  branch: string;
  dirty: boolean;
  manifest_sha256: string;
  tmvc_file_hashes: Record<string, string>;
}

function sha256(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function collectRelativeFilePaths(repoRoot: string, relativeRoots: string[]): string[] {
  const paths = new Set<string>();

  for (const relRoot of relativeRoots) {
    const absolute = path.join(repoRoot, relRoot);
    if (!fs.existsSync(absolute)) continue;

    const stat = fs.statSync(absolute);
    if (stat.isFile()) {
      paths.add(path.relative(repoRoot, absolute).replaceAll("\\", "/"));
      continue;
    }

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const child = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(child);
        else if (entry.isFile()) paths.add(path.relative(repoRoot, child).replaceAll("\\", "/"));
      }
    };
    walk(absolute);
  }

  return [...paths].sort();
}

function hashFilesByRelativePath(repoRoot: string, relativePaths: string[]): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const rel of relativePaths) {
    const absolute = path.join(repoRoot, rel);
    try {
      hashes[rel] = sha256(fs.readFileSync(absolute));
    } catch {
      /* unreadable — skip */
    }
  }
  return hashes;
}

function readCurrentBranch(repoRoot: string): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function isWorkingTreeDirty(repoRoot: string): boolean {
  return execSync("git status --porcelain", { cwd: repoRoot, encoding: "utf8" }).trim().length > 0;
}

function tmvcRootsForSkill(manifest: Manifest, skillKey: string | null): string[] {
  if (!skillKey) return [];
  const skill = manifest.skills[skillKey];
  return skill ? [...skill.tmvc_roots] : [];
}

export function captureStartState(
  repoRoot: string,
  manifest: Manifest,
  skillKey: string | null,
): StartStateSnapshot {
  const headSha = execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
  const manifestPath = path.join(repoRoot, REL_MANIFEST);
  const manifestBytes = fs.readFileSync(manifestPath);
  const roots = tmvcRootsForSkill(manifest, skillKey);
  const trackedFiles = collectRelativeFilePaths(repoRoot, roots);

  return {
    captured_at: new Date().toISOString(),
    head_sha: headSha,
    branch: readCurrentBranch(repoRoot),
    dirty: isWorkingTreeDirty(repoRoot),
    manifest_sha256: sha256(manifestBytes),
    tmvc_file_hashes: hashFilesByRelativePath(repoRoot, trackedFiles),
  };
}

export function writeSnapshot(repoRoot: string, snapshot: StartStateSnapshot, msnId: string): string {
  const historyDir = path.join(repoRoot, REL_HISTORY_DIR);
  fs.mkdirSync(historyDir, { recursive: true });
  const safeName = msnId.replace(/[^\w.-]+/g, "_");
  const outFile = path.join(historyDir, `start-state.${safeName}.json`);
  fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2), "utf8");
  return outFile;
}
