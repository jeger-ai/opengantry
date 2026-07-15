import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { CLI_NAME } from "./constants.js";
import { errorMessage, fromPosix, logInfo } from "./cli-io.js";
import { promoteFileAtomic } from "./atomic-fs.js";
import { assertPlannerMissionProof } from "./git-proof.js";
import {
  mergeGitignoreFromTemplate,
  mergePrettierignoreFromTemplate,
} from "./file-merge-gxt.js";
import { resolveTemplateRootFromModule } from "./integration-compat.js";
import { resolveMissionPathRequired } from "./missions/parser.js";
import { assertMissionSchemaValid } from "./missions/validator.js";
import { assertMcpSubstrateUpgradeWritePaths, McpWriteDeniedError } from "./mcp-write-guard.js";
import { loadManifest } from "./manifest.js";
import { writeSubstrateVersionFile } from "./substrate-version.js";
import {
  parseUpgradePayloadFromMissionBody,
  REL_UPGRADE_TMP,
  type UpgradePayload,
} from "./upgrade-plan.js";
import { GantryUserError } from "./errors.js";

export const REL_UPGRADE_APPLY_TMP = ".gitagent/.upgrade-apply-tmp" as const;

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
  const tmpRoot = path.join(repoRoot, fromPosix(REL_UPGRADE_TMP));
  if (!fs.existsSync(tmpRoot)) {
    throw new GantryUserError(
      "UPGRADE_STAGING_MISSING",
      `${CLI_NAME} upgrade --apply: staging directory missing at ${REL_UPGRADE_TMP}/ — re-run gantry upgrade`,
      `Run \`gantry upgrade\` to regenerate staged files before apply.`,
    );
  }

  const entries = Object.entries(payload.staged_hashes);
  if (entries.length === 0) {
    throw new GantryUserError(
      "UPGRADE_EMPTY_MANIFEST",
      `${CLI_NAME} upgrade --apply: upgrade_payload.staged_hashes is empty`,
    );
  }

  for (const [relPath, expectedHash] of entries) {
    const stageAbs = path.join(tmpRoot, fromPosix(relPath));
    if (!fs.existsSync(stageAbs)) {
      throw new GantryUserError(
        "UPGRADE_STAGING_DRIFT",
        `${CLI_NAME} upgrade --apply: missing staged file ${relPath} under ${REL_UPGRADE_TMP}/`,
        "Re-run gantry upgrade to regenerate staging after mission was signed.",
      );
    }
    const actual = sha256File(stageAbs);
    if (actual !== expectedHash) {
      throw new GantryUserError(
        "UPGRADE_HASH_MISMATCH",
        `${CLI_NAME} upgrade --apply: staged file hash mismatch for ${relPath}`,
        "Staging directory was modified after plan. Re-run gantry upgrade and re-sign the mission.",
      );
    }
  }
}

function cleanupApplyTmp(applyTmpRoot: string): void {
  if (fs.existsSync(applyTmpRoot)) {
    fs.rmSync(applyTmpRoot, { recursive: true, force: true });
  }
}

async function stageWritesForApply(
  repoRoot: string,
  payload: UpgradePayload,
): Promise<{ applyTmpRoot: string; promotions: Array<{ staged: string; target: string }> }> {
  const tmpRoot = path.join(repoRoot, fromPosix(REL_UPGRADE_TMP));
  const applyTmpRoot = path.join(repoRoot, fromPosix(REL_UPGRADE_APPLY_TMP));
  cleanupApplyTmp(applyTmpRoot);
  fs.mkdirSync(applyTmpRoot, { recursive: true });

  const promotions: Array<{ staged: string; target: string }> = [];
  for (const relPath of payload.planned_writes) {
    const sourceAbs = path.join(tmpRoot, fromPosix(relPath));
    const stagedAbs = path.join(applyTmpRoot, fromPosix(relPath));
    const prodAbs = path.join(repoRoot, fromPosix(relPath));
    fs.mkdirSync(path.dirname(stagedAbs), { recursive: true });
    fs.copyFileSync(sourceAbs, stagedAbs);
    promotions.push({ staged: stagedAbs, target: prodAbs });
  }
  return { applyTmpRoot, promotions };
}

async function promoteStagedWrites(
  promotions: Array<{ staged: string; target: string }>,
): Promise<void> {
  for (const { staged, target } of promotions) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await promoteFileAtomic(staged, target);
  }
}

export interface RunUpgradeApplyOptions {
  repoRoot: string;
  mission?: string;
  templatesRoot?: string;
  json?: boolean;
}

export async function runUpgradeApply(options: RunUpgradeApplyOptions): Promise<UpgradeApplyResult> {
  const repoRoot = path.resolve(options.repoRoot);
  const templatesRoot = options.templatesRoot ?? resolveTemplateRootFromModule();
  const missionAbs = resolveMissionPathRequired(repoRoot, { explicit: options.mission });
  const missionBody = fs.readFileSync(missionAbs, "utf8");

  let payload: UpgradePayload;
  try {
    const data = YAML.parse(missionBody) as unknown;
    assertMissionSchemaValid(repoRoot, data, missionAbs);
    payload = parseUpgradePayloadFromMissionBody(missionBody);
  } catch (e) {
    throw new GantryUserError(
      "UPGRADE_INVALID_MISSION",
      errorMessage(e),
    );
  }

  try {
    assertPlannerMissionProof(repoRoot, missionAbs);
  } catch (e) {
    return {
      status: "blocked",
      message: errorMessage(e),
    };
  }

  try {
    const manifest = loadManifest(repoRoot);
    assertMcpSubstrateUpgradeWritePaths(manifest, payload.planned_writes);
  } catch (e) {
    if (e instanceof McpWriteDeniedError) {
      throw new GantryUserError(e.code, e.message, e.hint);
    }
    throw e;
  }

  verifyStagedHashes(repoRoot, payload);

  const tmpRoot = path.join(repoRoot, fromPosix(REL_UPGRADE_TMP));
  let applyTmpRoot = "";
  try {
    const staged = await stageWritesForApply(repoRoot, payload);
    applyTmpRoot = staged.applyTmpRoot;
    await promoteStagedWrites(staged.promotions);

    mergeGitignoreFromTemplate(repoRoot, templatesRoot);
    mergePrettierignoreFromTemplate(repoRoot, templatesRoot);
    writeSubstrateVersionFile(repoRoot, payload.to_version, "gantry upgrade --apply");
  } catch (e) {
    cleanupApplyTmp(applyTmpRoot);
    throw e;
  } finally {
    cleanupApplyTmp(applyTmpRoot);
    if (fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }

  const appliedPaths = payload.planned_writes;
  const message = [
    `${CLI_NAME} upgrade: applied substrate ${payload.from_version} → ${payload.to_version}`,
    `Updated ${appliedPaths.length} managed asset(s).`,
    "Next: restart Cursor, confirm MCP enabled, run gantry doctor.",
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
