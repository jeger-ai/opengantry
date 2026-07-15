import path from "node:path";
import { GIT_CONFIG_PLANNER_EMAILS } from "./config-namespace.js";
import { CLI_NAME, MSN_ID_PATTERN } from "./constants.js";
import { toPosixRel } from "./cli-io.js";
import { gitRun } from "./git.js";
import { hintGitProof, type GitProofHintContext } from "./fix-hints.js";
import { GantryUserError } from "./errors.js";
import { extractMsnIdFromMissionPath } from "./missions/parser.js";
import { resolvePlannerEmails } from "./planner-identity.js";
import { loadGxtConfig, resolvePlannerSignatureTier } from "./gxt-config.js";
import { checkPlannerStampSignature } from "./planner-signature.js";
import { logWarn } from "./cli-io.js";
import { archOverrideAdvisoryMessage, commitSubjectHasArchOverride } from "./arch-override.js";

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

export { ENV_PLANNER_EMAILS, parsePlannerEmailsFromEnv } from "./planner-identity.js";

export const ENV_MSN_SCAN_DEPTH = "GXT_MSN_SCAN_DEPTH" as const;
export const DEFAULT_MSN_SCAN_DEPTH = 200;

/** Resolve git-proof scan depth: explicit option, then env, then default. */
export function resolveMsnScanDepth(explicit?: number): number {
  if (explicit !== undefined && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  const envRaw = process.env[ENV_MSN_SCAN_DEPTH];
  if (envRaw !== undefined && envRaw.trim() !== "") {
    const envParsed = Number.parseInt(envRaw.trim(), 10);
    if (Number.isFinite(envParsed) && envParsed > 0) {
      return envParsed;
    }
  }
  return DEFAULT_MSN_SCAN_DEPTH;
}

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

export interface MsnCommitRow {
  hash: string;
  subject: string;
  authorEmail: string;
}

/**
 * True iff the commit **subject line** (`git log` %s) begins with `[msnId]` as legislation.
 * Does not inspect the commit body — avoids matching `[MSN-…]` that appears only in the body.
 */
export function commitSubjectHasMsnPrefix(subject: string, msnId: string): boolean {
  if (!MSN_ID_PATTERN.test(msnId)) return false;
  const prefix = `[${msnId}]`;
  const s = subject.trimStart();
  return s.startsWith(prefix);
}

/**
 * Newest-first commits among the last `scanDepth` history entries whose **subject** (%s) starts
 * with `[msnId]`. Uses plain `git log` (no `--grep`) so matches cannot come from the body alone.
 */
export function listMsnSubjectCommits(
  root: string,
  msnId: string,
  scanDepth?: number,
): MsnCommitRow[] {
  const depth = resolveMsnScanDepth(scanDepth);
  const { ok, stdout, stderr } = gitRun(root, [
    "log",
    "-z",
    "--format=%H%x1f%s%x1f%aE",
    "-n",
    String(depth),
  ]);
  if (!ok) {
    throw new Error(
      `${CLI_NAME} verify: git-proof: git log failed: ${stderr.trim() || stdout.trim() || "unknown"}`,
    );
  }
  if (!stdout.trim()) return [];
  const chunks = stdout.split("\0").filter((c) => c.length > 0);
  const rows: MsnCommitRow[] = [];
  for (const chunk of chunks) {
    const parts = chunk.split("\x1f");
    if (parts.length < 3) continue;
    const [hash, subject, authorEmail] = parts;
    if (!hash || !subject || !authorEmail) continue;
    if (!commitSubjectHasMsnPrefix(subject, msnId)) continue;
    rows.push({ hash, subject, authorEmail });
  }
  return rows;
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
 * Forensic gate (v0.6.2): MSN is read from the mission file; the most recent
 * Planner-authored commit whose subject starts with `[MSN-XXXX]` must modify
 * that mission path. Returns the resolved MSN id.
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

  const stamp = rows.find((r) => isPlannerEmail(r.authorEmail, plannerEmails));
  if (!stamp) {
    const latest = rows[0]!;
    throwGitProofError(
      "NO_PLANNER_MSN_COMMIT",
      `The legislation was committed by ${JSON.stringify(latest.authorEmail)}, who is not in the Planner allowlist (${plannerIdentity.detail}). ` +
        `Add that email to .gitagent/foreman/PLANNER.allowlist.local, git config ${GIT_CONFIG_PLANNER_EMAILS}, or run ${CLI_NAME} planner set.`,
      { root, missionPath, msnId, latestAuthorEmail: latest.authorEmail },
    );
  }

  const changed = listCommitChangedPaths(root, stamp.hash);
  if (!commitTouchesMission(changed, repoRelMission)) {
    throwGitProofError(
      "MISSION_FILE_NOT_MODIFIED_BY_PLANNER",
      `The Planner stamp for [${msnId}] is commit ${stamp.hash}: ${stamp.subject.trim()}; it did not change this mission file (${repoRelMission}). ` +
        `The stamp is the newest (scanning backward) commit authored by a Planner allowlist email (${plannerIdentity.detail}) whose subject begins with [${msnId}]. ` +
        `Either add a newer Planner commit with that subject that includes ${repoRelMission}, or reuse a distinct MSN whose only qualifying commits touch this file.`,
      {
        root,
        missionPath,
        msnId,
        repoRelMission,
        stampHash: stamp.hash,
        stampSubject: stamp.subject.trim(),
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
