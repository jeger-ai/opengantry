import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { GantryUserError } from "./errors.js";
import { parseMissionFile, assertMissionGatePresent } from "./missions/parser.js";
import { resolveOrgExportConfig } from "./org-export-config.js";

/** Canonical digest for a passed verify with zero advisory findings. */
export const PASSED_FINDINGS_DIGEST = crypto
  .createHash("sha256")
  .update("[]", "utf8")
  .digest("hex");

export interface VerdictExpectedClaims {
  msn_id: string;
  mission_sha256: string;
  findings_digest: string;
  gate_command: string;
  org_id: string;
}

function sha256File(absPath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(absPath)).digest("hex");
}

function missionAbsPath(repoRoot: string, missionRelPath: string): string {
  return path.isAbsolute(missionRelPath) ? missionRelPath : path.join(repoRoot, missionRelPath);
}

/** Build server-side verdict claims after a successful gantry::verify pass. */
export function buildVerdictExpectedClaims(
  repoRoot: string,
  missionRelPath: string,
): VerdictExpectedClaims {
  const missionAbs = missionAbsPath(repoRoot, missionRelPath);
  const mission = parseMissionFile(repoRoot, missionRelPath);
  assertMissionGatePresent(mission);
  const msnId = mission.msnId?.trim();
  if (!msnId) {
    throw new GantryUserError(
      "MISSION_MSN_MISSING",
      "buildVerdictExpectedClaims: mission msn_id required",
      missionRelPath,
      2,
    );
  }
  let org_id: string;
  try {
    org_id = resolveOrgExportConfig(repoRoot).org_id;
  } catch (e) {
    throw new GantryUserError(
      "ORG_EXPORT_CONFIG_MISSING",
      "buildVerdictExpectedClaims requires org export config (GANTRY_ORG_ID + GANTRY_ORG_PEPPER or ORG.export.local)",
      e instanceof Error ? e.message : String(e),
      2,
    );
  }
  return {
    msn_id: msnId,
    mission_sha256: sha256File(missionAbs),
    findings_digest: PASSED_FINDINGS_DIGEST,
    gate_command: mission.gate!.command.trim(),
    org_id,
  };
}
