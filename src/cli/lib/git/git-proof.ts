import path from "node:path";
import { GIT_CONFIG_PLANNER_EMAILS } from "../config-namespace.js";
import { CLI_NAME, MSN_ID_PATTERN } from "../constants.js";
import { toPosixRel } from "../cli-io.js";
import { gitRun } from "#git/git.js";
import { hintGitProof, type GitProofHintContext } from "../fix-hints.js";
import { GantryUserError } from "../errors.js";
import { extractMsnIdFromMissionPath } from "../missions/parser.js";
import { resolvePlannerEmails } from "../planner-identity.js";
import { loadGxtConfig, resolvePlannerSignatureTier } from "../gxt-config.js";
import { checkPlannerStampSignature } from "../planner-signature.js";
import { logWarn } from "../cli-io.js";
import { archOverrideAdvisoryMessage, commitSubjectHasArchOverride } from "../arch-override.js";

function throwGitProofError(
  code: string,
  detail: string,
  ctx: GitProofHintContext = {},
): never {
  throw new GantryUserError(
    code,
    `${CLI_NAME} verify: git-proof: ${code} — ${detail}`,
    hintGitProof(code, ctx),
  );
}

/** Missions verified by `gantry verify` must live under this repo-relative prefix. */
export const REL_MISSIONS_PREFIX = ".gitagent/missions/" as const;
export {
  DEFAULT_MSN_SCAN_DEPTH,
  ENV_MSN_SCAN_DEPTH,
  commitSubjectHasMsnPrefix,
  listMsnSubjectCommits,
  resolveMsnScanDepth,
  type MsnCommitRow,
} from "#git/msn-commits.js";
import { listMsnSubjectCommits, resolveMsnScanDepth, type MsnCommitRow } from "#git/msn-commits.js";

export function missionPathRepoRelative(root: string, missionAbsolutePath: string): string {
  const absMission = path.resolve(missionAbsolutePath);
  const absRoot = path.resolve(root);
  const rel = path.relative(absRoot, absMission);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `${CLI_NAME} verify: mission file is outside repository root (${missionAbsolutePath})`,
    );
  }
  return toPosixRel(absRoot, absMission);
}

export function assertMissionUnderMissionsDir(repoRelMissionPath: string): void {
  const norm = repoRelMissionPath.replace(/\\/g, "/");
  if (!norm.startsWith(REL_MISSIONS_PREFIX)) {
    throwGitProofError(
      "MISSION_OUTSIDE_MISSIONS_DIR",
      `mission must live under ${REL_MISSIONS_PREFIX} (got "${norm}")`,
      { repoRelMission: norm },
    );
  }
}

function normalizeChangedPath(p: string): string {
  return p.trim().replaceAll(path.sep, "/");
}

/** Paths changed in commit `hash` (repo-relative forward slashes). */
export function listCommitChangedPaths(root: string, hash: string): string[] {
  const { ok, stdout, stderr } = gitRun(root, ["show", "--name-only", "--pretty=format:", hash]);
  if (!ok) {
    throw new Error(
      `${CLI_NAME} verify: git-proof: git show failed for ${hash}: ${stderr.trim() || "unknown"}`,
    );
  }
  return stdout
    .split("\n")
    .map((l) => normalizeChangedPath(l))
    .filter((l) => l.length > 0);
}

function isPlannerEmail(authorEmail: string, plannerEmails: string[]): boolean {
  return plannerEmails.includes(authorEmail.trim().toLowerCase());
}

function commitTouchesMission(changed: string[], repoRelMission: string): boolean {
  const normMission = repoRelMission.replace(/\\/g, "/");
  return changed.some((p) => p.replace(/\\/g, "/") === normMission);
}

/**
 * The Planner stamp commit for an MSN (RULES §6.1): the newest commit whose subject begins with [MSN], whose author is
 * on the Planner allowlist and which modifies the mission file; null when there is none or no allowlist is configured.
 */
export function findPlannerStamp(root: string, msnId: string, repoRelMission: string, scanDepth?: number): MsnCommitRow | null {
  const plannerEmails = resolvePlannerEmails(root).emails;
  if (plannerEmails.length === 0) return null;
  const rows = listMsnSubjectCommits(root, msnId, resolveMsnScanDepth(scanDepth)).filter((r) => isPlannerEmail(r.authorEmail, plannerEmails));
  return rows.find((r) => commitTouchesMission(listCommitChangedPaths(root, r.hash), repoRelMission)) ?? null;
}

export interface PlannerMissionProofOptions {
  /** Max commits to scan in `git log` (default 200). */
  scanDepth?: number;
  /** When set, must match parser-resolved mission MSN (avoids re-resolving identity from disk). */
  msnId?: string;
  /** Collect non-fatal planner_signature warn-tier messages (verify). */
  warnings?: string[];
}

function enforcePlannerStampSignature(
  root: string,
  stamp: MsnCommitRow,
  ctx: GitProofHintContext,
  options?: PlannerMissionProofOptions,
): void {
  const signatureTier = resolvePlannerSignatureTier(loadGxtConfig(root));
  if (signatureTier === "off") return;

  const sig = checkPlannerStampSignature(root, stamp.hash);
  if (sig.ok) return;

  const detail = `Planner stamp ${stamp.hash} is unsigned (git %G?=${sig.status})`;
  if (signatureTier === "require") {
    throwGitProofError("PLANNER_STAMP_UNSIGNED", detail, {
      ...ctx,
      stampHash: stamp.hash,
      stampSubject: stamp.subject.trim(),
    });
  }
  const warning = `${CLI_NAME} verify: ${detail}`;
  options?.warnings?.push(warning);
  logWarn(warning);
}

/**
 * Forensic gate (v0.6.2, rule amended by ADR-0052 step 4): MSN is read from the mission file; the stamp is the most
 * recent Planner-authored commit whose subject starts with `[MSN-XXXX]` and which modifies that mission path. Returns
 * the resolved MSN id.
 */
export function assertPlannerMissionProof(
  root: string,
  missionAbsolutePath: string,
  options?: PlannerMissionProofOptions,
): string {
  const msnId =
    options?.msnId && MSN_ID_PATTERN.test(options.msnId)
      ? options.msnId
      : extractMsnIdFromMissionPath(missionAbsolutePath);
  const missionPath = missionAbsolutePath;
  if (!msnId || !MSN_ID_PATTERN.test(msnId)) {
    throwGitProofError(
      "MISSION_MISSING_MSN",
      "The mission file is missing a valid [MSN-XXXX] identifier (YAML/frontmatter msn_id or msnId, line-start [MSN-NNNN], or # Mission: line).",
      { root, missionPath },
    );
  }

  const plannerIdentity = resolvePlannerEmails(root);
  const plannerEmails = plannerIdentity.emails;
  if (plannerEmails.length === 0) {
    throwGitProofError(
      "PLANNER_IDENTITY_UNCONFIGURED",
      "No Planner allowlist configured for this repository.",
      { root, missionPath, msnId },
    );
  }

  const repoRelMission = missionPathRepoRelative(root, missionAbsolutePath);
  assertMissionUnderMissionsDir(repoRelMission);

  const rows = listMsnSubjectCommits(root, msnId, resolveMsnScanDepth(options?.scanDepth));
  if (rows.length === 0) {
    throwGitProofError(
      "NO_MSN_COMMITS",
      `No commits found starting with [${msnId}]. Did you commit the mission?`,
      { root, missionPath, msnId, repoRelMission },
    );
  }

  const plannerRows = rows.filter((r) => isPlannerEmail(r.authorEmail, plannerEmails));
  const newestPlanner = plannerRows[0];
  if (!newestPlanner) {
    const latest = rows[0]!;
    throwGitProofError(
      "NO_PLANNER_MSN_COMMIT",
      `The legislation was committed by ${JSON.stringify(latest.authorEmail)}, who is not in the Planner allowlist (${plannerIdentity.detail}). ` +
        `Add that email to .gitagent/foreman/PLANNER.allowlist.local, git config ${GIT_CONFIG_PLANNER_EMAILS}, or run ${CLI_NAME} planner set.`,
      { root, missionPath, msnId, latestAuthorEmail: latest.authorEmail },
    );
  }

  // RULES §6.1 (ADR-0052 step 4): the stamp is the newest Planner-email [MSN] commit that modifies the mission file.
  // Later Planner-email commits that leave the mission alone (an executor sharing the identity) do not displace it.
  const stamp = plannerRows.find((r) => commitTouchesMission(listCommitChangedPaths(root, r.hash), repoRelMission));
  if (!stamp) {
    throwGitProofError(
      "MISSION_FILE_NOT_MODIFIED_BY_PLANNER",
      `No [${msnId}] commit by a Planner allowlist email (${plannerIdentity.detail}) changes this mission file (${repoRelMission}); the newest is ${newestPlanner.hash}: ${newestPlanner.subject.trim()}. ` +
        `The stamp is the newest commit whose subject begins with [${msnId}], whose author is on the Planner allowlist and which modifies ${repoRelMission}. ` +
        `Add a Planner commit with that subject that includes ${repoRelMission}, or reuse a distinct MSN whose qualifying commits touch this file.`,
      {
        root,
        missionPath,
        msnId,
        repoRelMission,
        stampHash: newestPlanner.hash,
        stampSubject: newestPlanner.subject.trim(),
      },
    );
  }

  enforcePlannerStampSignature(
    root,
    stamp,
    { root, missionPath, msnId, repoRelMission },
    options,
  );

  if (commitSubjectHasArchOverride(stamp.subject)) {
    const msg = archOverrideAdvisoryMessage(msnId, stamp.hash);
    options?.warnings?.push(msg);
    logWarn(msg);
  }

  return msnId;
}

/** Non-throwing git-proof check for onboarding/tutorial flows. */
export function plannerMissionStamped(
  root: string,
  missionAbsolutePath: string,
  options?: PlannerMissionProofOptions,
): boolean {
  try {
    assertPlannerMissionProof(root, missionAbsolutePath, options);
    return true;
  } catch {
    return false;
  }
}
