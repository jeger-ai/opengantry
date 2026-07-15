import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { CLI_NAME } from "./constants.js";
import { fromPosix, toPosixRel } from "./cli-io.js";
import { allocateMsn } from "./msn-allocate.js";
import {
  buildLegislativeTraceRows,
  buildMissionYamlScaffold,
  isValidMsnId,
} from "./missions/parser.js";
import type { PlannedWrite } from "./init-plan.js";
import { REL_UPGRADE_TMP, type UpgradePayload } from "./upgrade-plan-types.js";

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

export function writeStagedFiles(repoRoot: string, writes: PlannedWrite[]): Record<string, string> {
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

export { semverSlug };
