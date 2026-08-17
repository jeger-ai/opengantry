import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { GantryUserError } from "./errors.js";
import { parseMissionFile, assertMissionGatePresent } from "./missions/parser.js";
import { REL_ORG_EXPORT_LOCAL, resolveOrgId } from "./org-export-config.js";

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

function orgExportMtimeMs(repoRoot: string): number | undefined {
  const abs = path.join(repoRoot, REL_ORG_EXPORT_LOCAL);
  try {
    return fs.statSync(abs).mtimeMs;
  } catch {
    return undefined;
  }
}

const claimsCache = new Map<string, VerdictExpectedClaims>();

function cacheKey(
  repoRoot: string,
  missionRelPath: string,
  missionMtimeMs: number,
  missionSize: number,
  orgMtimeMs: number | undefined,
): string {
  return `${repoRoot}\0${missionRelPath}\0${missionMtimeMs}\0${missionSize}\0${orgMtimeMs ?? ""}`;
}

/** Build server-side verdict claims (uncached primitive). */
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
  const org_id = resolveOrgId(repoRoot);
  return {
    msn_id: msnId,
    mission_sha256: sha256File(missionAbs),
    findings_digest: PASSED_FINDINGS_DIGEST,
    gate_command: mission.gate!.command.trim(),
    org_id,
  };
}

/** Memoized promote-path entry: recomputes when mission or org export file changes. */
export function verdictClaimsFor(
  repoRoot: string,
  missionRelPath: string,
): VerdictExpectedClaims {
  const missionAbs = missionAbsPath(repoRoot, missionRelPath);
  const missionStat = fs.statSync(missionAbs);
  const orgMtime = orgExportMtimeMs(repoRoot);
  const key = cacheKey(
    repoRoot,
    missionRelPath,
    missionStat.mtimeMs,
    missionStat.size,
    orgMtime,
  );
  const hit = claimsCache.get(key);
  if (hit) return hit;
  const claims = buildVerdictExpectedClaims(repoRoot, missionRelPath);
  claimsCache.set(key, claims);
  return claims;
}

/** Test-only: clear memoization between cases. */
export function clearVerdictClaimsCache(): void {
  claimsCache.clear();
}
