import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { CLI_NAME } from "./constants.js";
import { logInfo, logWarn } from "./cli-io.js";
import { mergeGitignoreFromTemplate } from "./gitignore-gxt.js";
import { resolveTemplateRootFromModule, loadIntegrationCompat } from "./integration-compat.js";
import { resolveAssetsFromProfile } from "./init-asset-catalog.js";
import { planInitAssets, type PlannedWrite } from "./init-plan.js";
import { upgradeEligibleAssets } from "./upgrade-eligible-assets.js";
import { inferInitProfileFromRepo } from "./upgrade-profile.js";
import {
  alreadyCurrentMessage,
  compareSemver,
  legacyVersionWarning,
  readInstalledSubstrateVersion,
} from "./substrate-version.js";
import { allocateMsn } from "./msn-allocate.js";
import { isValidMsnId } from "./msn.js";
import { buildLegislativeTraceRows } from "./mission-yaml.js";

export const REL_UPGRADE_TMP = ".gitagent/.upgrade-tmp" as const;
export { UPGRADE_MSN_BAND_MIN, UPGRADE_MSN_BAND_MAX } from "./msn-allocate.js";

export interface UpgradePayload {
  from_version: string;
  to_version: string;
  staged_root: typeof REL_UPGRADE_TMP;
  planned_writes: string[];
  skipped_scaffold_only: string[];
  staged_hashes: Record<string, string>;
  created_at: string;
}

export interface UpgradePlanResult {
  status: "planned" | "already_current" | "downgrade_blocked" | "no_changes";
  from_version: string;
  to_version: string;
  installed_source?: string;
  message?: string;
  mission_path?: string;
  mission_rel?: string;
  suggested_human_action?: string;
  planned_writes?: string[];
  skipped_scaffold_only?: string[];
  unchanged?: string[];
  legacy_warning?: string | null;
}

function sha256Buffer(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function semverSlug(version: string): string {
  return version.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export function pickNextUpgradeMsn(repoRoot: string): string {
  return allocateMsn(repoRoot, { band: "upgrade" });
}

export function resolveUpgradeMsn(repoRoot: string, explicit?: string): string {
  const msn = explicit?.trim();
  if (msn) {
    if (!isValidMsnId(msn)) {
      throw new Error(`${CLI_NAME} upgrade: invalid --msn (expected MSN-NNNN)`);
    }
    return msn;
  }
  return pickNextUpgradeMsn(repoRoot);
}

function upgradeTmpAbs(repoRoot: string): string {
  return path.join(repoRoot, REL_UPGRADE_TMP.split("/").join(path.sep));
}

function stagePathForTarget(repoRoot: string, targetRel: string): string {
  return path.join(upgradeTmpAbs(repoRoot), targetRel.split("/").join(path.sep));
}

function writeStagedFiles(repoRoot: string, writes: PlannedWrite[]): Record<string, string> {
  const stagedHashes: Record<string, string> = {};
  const tmpRoot = upgradeTmpAbs(repoRoot);
  if (fs.existsSync(tmpRoot)) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
  for (const w of writes) {
    const rel = path.relative(repoRoot, w.absoluteTarget).split(path.sep).join("/");
    const stageAbs = stagePathForTarget(repoRoot, rel);
    fs.mkdirSync(path.dirname(stageAbs), { recursive: true });
    fs.writeFileSync(stageAbs, w.body, "utf8");
    if (w.executable) fs.chmodSync(stageAbs, 0o755);
    stagedHashes[rel] = sha256Buffer(Buffer.from(w.body, "utf8"));
  }
  return stagedHashes;
}

export function buildUpgradeMissionYaml(opts: {
  msnId: string;
  fromVersion: string;
  toVersion: string;
  payload: UpgradePayload;
}): string {
  const doc: Record<string, unknown> = {
    msn_id: opts.msnId,
    skill_key: "substrate",
    gate_command: "gapman doctor",
    gate_success_substring: null,
    upgrade_payload: opts.payload,
    trace_rows: buildLegislativeTraceRows(),
  };
  const header =
    `# OpenGantry substrate upgrade mission (Teacher: review staged diff under ${REL_UPGRADE_TMP}/).\n` +
    `# Upgrade ${opts.fromVersion} → ${opts.toVersion}. Commit this file only; staging dir is gitignored.\n`;
  return `${header}${YAML.stringify(doc)}`;
}

export function parseUpgradePayloadFromMissionBody(body: string): UpgradePayload {
  const data = YAML.parse(body) as Record<string, unknown>;
  const payload = data.upgrade_payload;
  if (typeof payload !== "object" || payload === null) {
    throw new Error(`${CLI_NAME} upgrade: mission missing upgrade_payload`);
  }
  const p = payload as Record<string, unknown>;
  const required = ["from_version", "to_version", "staged_hashes", "planned_writes"] as const;
  for (const key of required) {
    if (p[key] === undefined) {
      throw new Error(`${CLI_NAME} upgrade: upgrade_payload missing ${key}`);
    }
  }
  if (typeof p.from_version !== "string" || typeof p.to_version !== "string") {
    throw new Error(`${CLI_NAME} upgrade: upgrade_payload version fields must be strings`);
  }
  if (typeof p.staged_hashes !== "object" || p.staged_hashes === null || Array.isArray(p.staged_hashes)) {
    throw new Error(`${CLI_NAME} upgrade: upgrade_payload.staged_hashes must be an object`);
  }
  if (!Array.isArray(p.planned_writes)) {
    throw new Error(`${CLI_NAME} upgrade: upgrade_payload.planned_writes must be an array`);
  }
  const stagedHashes: Record<string, string> = {};
  for (const [k, v] of Object.entries(p.staged_hashes as Record<string, unknown>)) {
    if (typeof v !== "string") {
      throw new Error(`${CLI_NAME} upgrade: staged_hashes.${k} must be a string`);
    }
    stagedHashes[k] = v;
  }
  return {
    from_version: p.from_version,
    to_version: p.to_version,
    staged_root: REL_UPGRADE_TMP,
    planned_writes: p.planned_writes.map(String),
    skipped_scaffold_only: Array.isArray(p.skipped_scaffold_only)
      ? p.skipped_scaffold_only.map(String)
      : [],
    staged_hashes: stagedHashes,
    created_at: typeof p.created_at === "string" ? p.created_at : new Date().toISOString(),
  };
}

export interface RunUpgradePlanOptions {
  repoRoot: string;
  templatesRoot?: string;
  msn?: string;
  dryRun?: boolean;
  json?: boolean;
}

function resolveUpgradeVersionGate(
  installed: ReturnType<typeof readInstalledSubstrateVersion>,
  bundled: string,
  legacyWarning: string | null,
): UpgradePlanResult | null {
  if (compareSemver(bundled, installed.version) < 0) {
    return {
      status: "downgrade_blocked",
      from_version: installed.version,
      to_version: bundled,
      message: `${CLI_NAME} upgrade: bundled version ${bundled} is older than installed ${installed.version} — downgrade blocked`,
    };
  }

  if (compareSemver(installed.version, bundled) >= 0) {
    return {
      status: "already_current",
      from_version: installed.version,
      to_version: bundled,
      installed_source: installed.source,
      message: alreadyCurrentMessage(installed.version, bundled),
      legacy_warning: legacyWarning,
    };
  }

  return null;
}

function logUpgradePlanSummary(
  options: RunUpgradePlanOptions,
  opts: {
    plannedWrites: string[];
    legacyWarning: string | null;
    missionRel: string;
    suggestedHumanAction: string;
  },
): void {
  if (options.json) return;
  logInfo(`${CLI_NAME} upgrade: ${options.dryRun ? "dry-run — would stage" : "staged"} ${opts.plannedWrites.length} file(s) under ${REL_UPGRADE_TMP}/`);
  for (const rel of opts.plannedWrites) logInfo(`  - ${rel}`);
  if (opts.legacyWarning) logWarn(opts.legacyWarning);
  logInfo(`${options.dryRun ? "Would write" : "Wrote upgrade"} mission: ${opts.missionRel}`);
  logInfo(`${options.dryRun ? "Suggested Teacher action" : "Review staged diff, then"}:\n${opts.suggestedHumanAction}`);
  if (!options.dryRun) {
    logInfo(`After Teacher commit: gapman upgrade --apply --mission ${opts.missionRel}`);
  }
}

export function runUpgradePlan(options: RunUpgradePlanOptions): UpgradePlanResult {
  const repoRoot = path.resolve(options.repoRoot);
  const templatesRoot = options.templatesRoot ?? resolveTemplateRootFromModule();
  const compat = loadIntegrationCompat(templatesRoot);
  const bundled = compat.opengantry_version;
  const installed = readInstalledSubstrateVersion(repoRoot);
  const legacyWarning = legacyVersionWarning(installed.source);

  const versionGate = resolveUpgradeVersionGate(installed, bundled, legacyWarning);
  if (versionGate) return versionGate;

  const profile = inferInitProfileFromRepo(repoRoot, templatesRoot);
  const catalogAssets = resolveAssetsFromProfile(profile, compat);
  const assets = upgradeEligibleAssets(catalogAssets);
  const plan = planInitAssets(assets, templatesRoot, repoRoot, true);
  if (!plan.ok) {
    throw new Error(`${CLI_NAME} upgrade: asset planning failed`);
  }

  if (plan.writes.length === 0) {
    return {
      status: "no_changes",
      from_version: installed.version,
      to_version: bundled,
      message: `${CLI_NAME} upgrade: no managed_strict asset changes detected`,
      unchanged: plan.unchanged,
      skipped_scaffold_only: plan.skippedUserMutable,
      legacy_warning: legacyWarning,
    };
  }

  const msnId = resolveUpgradeMsn(repoRoot, options.msn);

  const plannedWrites = plan.writes.map((w) =>
    path.relative(repoRoot, w.absoluteTarget).split(path.sep).join("/"),
  );

  const payload: UpgradePayload = {
    from_version: installed.version,
    to_version: bundled,
    staged_root: REL_UPGRADE_TMP,
    planned_writes: plannedWrites,
    skipped_scaffold_only: plan.skippedUserMutable,
    staged_hashes: {},
    created_at: new Date().toISOString(),
  };

  const missionRel = `.gitagent/missions/${msnId}.upgrade-v${semverSlug(bundled)}.yaml`;
  const missionAbs = path.join(repoRoot, missionRel.split("/").join(path.sep));
  const suggestedHumanAction = `git add ${missionRel}\ngit commit -m "[${msnId}] approve substrate upgrade to v${bundled}"`;

  const shared: UpgradePlanResult = {
    status: "planned",
    from_version: installed.version,
    to_version: bundled,
    mission_rel: missionRel,
    suggested_human_action: suggestedHumanAction,
    planned_writes: plannedWrites,
    skipped_scaffold_only: plan.skippedUserMutable,
    unchanged: plan.unchanged,
    legacy_warning: legacyWarning,
  };

  if (options.dryRun) {
    logUpgradePlanSummary(options, { plannedWrites, legacyWarning, missionRel, suggestedHumanAction });
    return shared;
  }

  payload.staged_hashes = writeStagedFiles(repoRoot, plan.writes);
  mergeGitignoreFromTemplate(repoRoot, templatesRoot);
  const missionBody = buildUpgradeMissionYaml({ msnId, fromVersion: installed.version, toVersion: bundled, payload });
  fs.mkdirSync(path.dirname(missionAbs), { recursive: true });
  fs.writeFileSync(missionAbs, missionBody, "utf8");

  logUpgradePlanSummary(options, {
    plannedWrites,
    legacyWarning,
    missionRel,
    suggestedHumanAction,
  });

  return { ...shared, mission_path: missionAbs };
}
