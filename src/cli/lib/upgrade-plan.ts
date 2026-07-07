import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { CLI_NAME } from "./constants.js";
import { fromPosix, logInfo, logWarn, toPosixRel } from "./cli-io.js";
import {
  mergeGitignoreFromTemplate,
  mergePrettierignoreFromTemplate,
} from "./file-merge-gxt.js";
import {
  INTEGRATION_IDE_KEYS,
  loadIntegrationCompat,
  resolveTemplateRootFromModule,
  type IntegrationCompatManifest,
} from "./integration-compat.js";
import { resolveAssetsFromProfile } from "./init-asset-catalog.js";
import { planInitAssets, type PlannedWrite } from "./init-plan.js";
import {
  alreadyCurrentMessage,
  compareSemver,
  legacyVersionWarning,
  readInstalledSubstrateVersion,
} from "./substrate-version.js";
import { allocateMsn } from "./msn-allocate.js";
import {
  buildLegislativeTraceRows,
  buildMissionYamlScaffold,
  isValidMsnId,
} from "./missions/parser.js";
import { loadInitAssetCatalog, type InitAssetSpec } from "./init-asset-catalog.js";
import { defaultInitProfile, type InitProfile } from "./init-profile.js";

export const REL_UPGRADE_TMP = ".gitagent/.upgrade-tmp" as const;
export { UPGRADE_MSN_BAND_MIN, UPGRADE_MSN_BAND_MAX } from "./msn-allocate.js";

export interface UpgradeFileChange {
  path: string;
  action: "add" | "update";
  bytes_before: number | null;
  bytes_after: number;
  sha256_before: string | null;
  sha256_after: string;
}

/** managed_strict substrate assets eligible for gantry upgrade (excludes user law / missions). */
export function upgradeEligibleAssets(assets: InitAssetSpec[]): InitAssetSpec[] {
  return assets.filter((a) => a.mode === "managed_strict");
}

export function allUpgradeEligibleFromCatalog(templatesRoot: string): InitAssetSpec[] {
  return upgradeEligibleAssets([...loadInitAssetCatalog(templatesRoot)]);
}

function pathExists(repoRoot: string, rel: string): boolean {
  return fs.existsSync(path.join(repoRoot, rel.split("/").join(path.sep)));
}

function detectIntegrationPresent(
  repoRoot: string,
  key: string,
  entry: IntegrationCompatManifest["integrations"][typeof INTEGRATION_IDE_KEYS[number]],
): boolean {
  if (key === "codex-cli") {
    return pathExists(repoRoot, ".codex/config.toml");
  }
  return entry.canonical_paths.some((p) => pathExists(repoRoot, p));
}

/** Infer init profile from on-disk substrate assets for upgrade planning. */
export function inferInitProfileFromRepo(repoRoot: string, templatesRoot?: string): InitProfile {
  const profile = defaultInitProfile();
  const compat = loadIntegrationCompat(templatesRoot);
  const detected = INTEGRATION_IDE_KEYS.filter((key) =>
    detectIntegrationPresent(repoRoot, key, compat.integrations[key]),
  );
  if (detected.length > 0) {
    profile.ides = detected;
  }
  profile.gitHooks =
    pathExists(repoRoot, ".githooks/pre-push") || pathExists(repoRoot, ".githooks/pre-commit");
  profile.ciWorkflow = pathExists(repoRoot, ".github/workflows/gxt-validate.yml");
  profile.skillsPreset = pathExists(repoRoot, "skills/gantry.md") ? "specimen" : "minimal";
  return profile;
}

function fileState(absPath: string): { bytes: number; sha256: string } | null {
  if (!fs.existsSync(absPath)) return null;
  const buf = fs.readFileSync(absPath);
  return { bytes: buf.length, sha256: sha256Buffer(buf) };
}

/** Summarize planned upgrade writes for dry-run / changelog preview. */
export function buildUpgradeFileChanges(
  repoRoot: string,
  writes: PlannedWrite[],
): UpgradeFileChange[] {
  return writes.map((w) => {
    const rel = toPosixRel(repoRoot, w.absoluteTarget);
    const before = fileState(w.absoluteTarget);
    const afterBuf = Buffer.from(w.body, "utf8");
    return {
      path: rel,
      action: before === null ? "add" : "update",
      bytes_before: before?.bytes ?? null,
      bytes_after: afterBuf.length,
      sha256_before: before?.sha256 ?? null,
      sha256_after: sha256Buffer(afterBuf),
    };
  });
}

export function groupUpgradeChangesByCategory(
  changes: UpgradeFileChange[],
): Record<string, UpgradeFileChange[]> {
  const groups: Record<string, UpgradeFileChange[]> = {
    workflows: [],
    scripts: [],
    hooks: [],
    substrate: [],
    other: [],
  };
  for (const c of changes) {
    if (c.path.startsWith(".github/workflows/")) groups.workflows!.push(c);
    else if (c.path.startsWith("scripts/")) groups.scripts!.push(c);
    else if (c.path.startsWith(".githooks/") || c.path.startsWith(".cursor/hooks")) groups.hooks!.push(c);
    else if (c.path.startsWith(".gitagent/")) groups.substrate!.push(c);
    else groups.other!.push(c);
  }
  return groups;
}

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
  file_changes?: UpgradeFileChange[];
  changes_by_category?: Record<string, UpgradeFileChange[]>;
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
  return path.join(repoRoot, fromPosix(REL_UPGRADE_TMP));
}

function stagePathForTarget(repoRoot: string, targetRel: string): string {
  return path.join(upgradeTmpAbs(repoRoot), fromPosix(targetRel));
}

function writeStagedFiles(repoRoot: string, writes: PlannedWrite[]): Record<string, string> {
  const stagedHashes: Record<string, string> = {};
  const tmpRoot = upgradeTmpAbs(repoRoot);
  if (fs.existsSync(tmpRoot)) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
  for (const w of writes) {
    const rel = toPosixRel(repoRoot, w.absoluteTarget);
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
    gate_command: "gantry doctor",
    gate_success_substring: null,
    upgrade_payload: opts.payload,
    trace_rows: buildLegislativeTraceRows(),
  };
  return buildMissionYamlScaffold({
    header:
      `# OpenGantry substrate upgrade mission (Planner: review staged diff under ${REL_UPGRADE_TMP}/).\n` +
      `# Upgrade ${opts.fromVersion} → ${opts.toVersion}. Commit this file only; staging dir is gitignored.\n`,
    doc,
  });
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
    fileChanges?: UpgradeFileChange[];
  },
): void {
  if (options.json) return;
  logInfo(`${CLI_NAME} upgrade: ${options.dryRun ? "dry-run — would stage" : "staged"} ${opts.plannedWrites.length} file(s) under ${REL_UPGRADE_TMP}/`);
  for (const rel of opts.plannedWrites) logInfo(`  - ${rel}`);
  if (opts.fileChanges?.length) {
    logInfo("Changelog preview:");
    for (const c of opts.fileChanges) {
      const delta =
        c.bytes_before === null
          ? `new ${c.bytes_after} bytes`
          : `${c.bytes_before} → ${c.bytes_after} bytes`;
      logInfo(`  [${c.action}] ${c.path} (${delta})`);
    }
  }
  if (opts.legacyWarning) logWarn(opts.legacyWarning);
  logInfo(`${options.dryRun ? "Would write" : "Wrote upgrade"} mission: ${opts.missionRel}`);
  logInfo(`${options.dryRun ? "Suggested Planner action" : "Review staged diff, then"}:\n${opts.suggestedHumanAction}`);
  if (!options.dryRun) {
    logInfo(`After Planner commit: gantry upgrade --apply --mission ${opts.missionRel}`);
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
  const catalogAssets = resolveAssetsFromProfile(profile, compat, templatesRoot);
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
    toPosixRel(repoRoot, w.absoluteTarget),
  );

  const missionRel = `.gitagent/missions/${msnId}.upgrade-v${semverSlug(bundled)}.yaml`;
  const missionAbs = path.join(repoRoot, fromPosix(missionRel));
  const suggestedHumanAction = `git add ${missionRel}\ngit commit -m "[${msnId}] approve substrate upgrade to v${bundled}"`;

  const fileChanges = buildUpgradeFileChanges(repoRoot, plan.writes);
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
    file_changes: fileChanges,
    changes_by_category: groupUpgradeChangesByCategory(fileChanges),
  };

  if (options.dryRun) {
    logUpgradePlanSummary(options, { plannedWrites, legacyWarning, missionRel, suggestedHumanAction, fileChanges });
    return shared;
  }

  const stagedHashes = writeStagedFiles(repoRoot, plan.writes);
  mergeGitignoreFromTemplate(repoRoot, templatesRoot);
  mergePrettierignoreFromTemplate(repoRoot, templatesRoot);
  const payload: UpgradePayload = {
    from_version: installed.version,
    to_version: bundled,
    staged_root: REL_UPGRADE_TMP,
    planned_writes: plannedWrites,
    skipped_scaffold_only: plan.skippedUserMutable,
    staged_hashes: stagedHashes,
    created_at: new Date().toISOString(),
  };
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
