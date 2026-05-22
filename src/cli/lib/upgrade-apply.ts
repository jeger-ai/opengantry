import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CLI_NAME } from "./constants.js";
import { logInfo } from "./cli-io.js";
import { assertTeacherMissionProof } from "./git-proof.js";
import { applyInitWrites, type PlannedWrite } from "./init-plan.js";
import { resolveTemplateRootFromModule } from "./integration-compat.js";
import { mergeGitignoreFromTemplate } from "./gitignore-gxt.js";
import { writeSubstrateVersionFile } from "./substrate-version.js";
import {
  parseUpgradePayloadFromMissionBody,
  REL_UPGRADE_TMP,
  type UpgradePayload,
} from "./upgrade-plan.js";
import { GapmanUserError } from "./user-error.js";

export interface UpgradeApplyResult {
  status: "applied" | "blocked";
  message: string;
  to_version?: string;
  applied_paths?: string[];
}

function sha256File(absPath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(absPath)).digest("hex");
}

function verifyStagedHashes(repoRoot: string, payload: UpgradePayload): void {
  const tmpRoot = path.join(repoRoot, REL_UPGRADE_TMP.split("/").join(path.sep));
  if (!fs.existsSync(tmpRoot)) {
    throw new GapmanUserError(
      "UPGRADE_STAGING_MISSING",
      `${CLI_NAME} upgrade --apply: staging directory missing at ${REL_UPGRADE_TMP}/ — re-run gapman upgrade`,
      `Run \`gapman upgrade\` to regenerate staged files before apply.`,
    );
  }

  const entries = Object.entries(payload.staged_hashes);
  if (entries.length === 0) {
    throw new GapmanUserError(
      "UPGRADE_EMPTY_MANIFEST",
      `${CLI_NAME} upgrade --apply: upgrade_payload.staged_hashes is empty`,
    );
  }

  for (const [relPath, expectedHash] of entries) {
    const stageAbs = path.join(tmpRoot, relPath.split("/").join(path.sep));
    if (!fs.existsSync(stageAbs)) {
      throw new GapmanUserError(
        "UPGRADE_STAGING_DRIFT",
        `${CLI_NAME} upgrade --apply: missing staged file ${relPath} under ${REL_UPGRADE_TMP}/`,
        "Re-run gapman upgrade to regenerate staging after mission was signed.",
      );
    }
    const actual = sha256File(stageAbs);
    if (actual !== expectedHash) {
      throw new GapmanUserError(
        "UPGRADE_HASH_MISMATCH",
        `${CLI_NAME} upgrade --apply: staged file hash mismatch for ${relPath}`,
        "Staging directory was modified after plan. Re-run gapman upgrade and re-sign the mission.",
      );
    }
  }
}

function resolveMissionPath(repoRoot: string, explicit?: string): string {
  if (explicit?.trim()) {
    const abs = path.isAbsolute(explicit) ? explicit : path.join(repoRoot, explicit.trim());
    if (!fs.existsSync(abs)) {
      throw new GapmanUserError(
        "MISSION_NOT_FOUND",
        `${CLI_NAME} upgrade --apply: mission not found at ${explicit}`,
      );
    }
    return abs;
  }

  const pinPath = path.join(repoRoot, ".gitagent/missions/.active-mission");
  if (fs.existsSync(pinPath)) {
    const pinned = fs.readFileSync(pinPath, "utf8").trim();
    if (pinned.length > 0) {
      const abs = path.isAbsolute(pinned) ? pinned : path.join(repoRoot, pinned);
      if (fs.existsSync(abs)) return abs;
    }
  }

  throw new GapmanUserError(
    "UPGRADE_MISSION_REQUIRED",
    `${CLI_NAME} upgrade --apply: pass --mission <path> to the signed upgrade mission YAML`,
    "Example: gapman upgrade --apply --mission .gitagent/missions/MSN-9001.upgrade-v0.8.1.yaml",
  );
}

export interface RunUpgradeApplyOptions {
  repoRoot: string;
  mission?: string;
  templatesRoot?: string;
  json?: boolean;
}

export function runUpgradeApply(options: RunUpgradeApplyOptions): UpgradeApplyResult {
  const repoRoot = path.resolve(options.repoRoot);
  const templatesRoot = options.templatesRoot ?? resolveTemplateRootFromModule();
  const missionAbs = resolveMissionPath(repoRoot, options.mission);
  const missionBody = fs.readFileSync(missionAbs, "utf8");

  let payload: UpgradePayload;
  try {
    payload = parseUpgradePayloadFromMissionBody(missionBody);
  } catch (e) {
    throw new GapmanUserError(
      "UPGRADE_INVALID_MISSION",
      e instanceof Error ? e.message : String(e),
    );
  }

  try {
    assertTeacherMissionProof(repoRoot, missionAbs);
  } catch (e) {
    return {
      status: "blocked",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  verifyStagedHashes(repoRoot, payload);

  const tmpRoot = path.join(repoRoot, REL_UPGRADE_TMP.split("/").join(path.sep));
  const writes: PlannedWrite[] = [];
  for (const relPath of payload.planned_writes) {
    const stageAbs = path.join(tmpRoot, relPath.split("/").join(path.sep));
    const prodAbs = path.join(repoRoot, relPath.split("/").join(path.sep));
    const body = fs.readFileSync(stageAbs, "utf8");
    const executable = fs.statSync(stageAbs).mode & 0o111 ? true : undefined;
    writes.push({ absoluteTarget: prodAbs, body, executable: executable === true });
  }

  applyInitWrites(writes);
  mergeGitignoreFromTemplate(repoRoot, templatesRoot);
  writeSubstrateVersionFile(repoRoot, payload.to_version, "gapman upgrade --apply");

  fs.rmSync(tmpRoot, { recursive: true, force: true });

  const appliedPaths = payload.planned_writes;
  const message = [
    `${CLI_NAME} upgrade: applied substrate ${payload.from_version} → ${payload.to_version}`,
    `Updated ${appliedPaths.length} managed asset(s).`,
    "Next: restart Cursor, confirm MCP enabled, run gapman doctor.",
  ].join("\n");

  if (!options.json) {
    logInfo(message);
  }

  return {
    status: "applied",
    message,
    to_version: payload.to_version,
    applied_paths: appliedPaths,
  };
}
