import path from "node:path";
import { CLI_NAME, MSN_ID_PATTERN } from "./constants.js";
import { toPosixRel } from "./cli-io.js";
import { gitRun } from "./git-repo.js";
import { hintGitProof, type GitProofHintContext } from "./fix-hints.js";
import { GapmanUserError } from "./user-error.js";

function throwGitProofError(
  code: string,
  detail: string,
  ctx: GitProofHintContext = {},
): never {
  throw new GapmanUserError(
    code,
    `${CLI_NAME} verify: git-proof: ${code} — ${detail}`,
    hintGitProof(code, ctx),
  );
}
import { extractMsnIdFromMissionPath } from "./mission-msn.js";
import { resolveTeacherEmails } from "./teacher-identity.js";

/** Missions verified by `gapman verify` must live under this repo-relative prefix. */
export const REL_MISSIONS_PREFIX = ".gitagent/missions/" as const;

export { ENV_TEACHER_EMAILS, parseTeacherEmailsFromEnv } from "./teacher-identity.js";

const DEFAULT_MSN_SCAN_DEPTH = 200;

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
  scanDepth: number = DEFAULT_MSN_SCAN_DEPTH,
): MsnCommitRow[] {
  const depth = Number.isFinite(scanDepth) && scanDepth > 0 ? Math.floor(scanDepth) : DEFAULT_MSN_SCAN_DEPTH;
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

function isTeacherEmail(authorEmail: string, teacherEmails: string[]): boolean {
  return teacherEmails.includes(authorEmail.trim().toLowerCase());
}

function commitTouchesMission(changed: string[], repoRelMission: string): boolean {
  const normMission = repoRelMission.replace(/\\/g, "/");
  return changed.some((p) => p.replace(/\\/g, "/") === normMission);
}

export interface TeacherMissionProofOptions {
  /** Max commits to scan in `git log` (default 200). */
  scanDepth?: number;
  /** When set, must match parser-resolved mission MSN (avoids re-resolving identity from disk). */
  msnId?: string;
}

/**
 * Forensic gate (v0.6.2): MSN is read from the mission file; the most recent
 * Teacher-authored commit whose subject starts with `[MSN-XXXX]` must modify
 * that mission path. Returns the resolved MSN id.
 */
export function assertTeacherMissionProof(
  root: string,
  missionAbsolutePath: string,
  options?: TeacherMissionProofOptions,
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

  const teacherIdentity = resolveTeacherEmails(root);
  const teacherEmails = teacherIdentity.emails;
  if (teacherEmails.length === 0) {
    throwGitProofError(
      "TEACHER_IDENTITY_UNCONFIGURED",
      "No Teacher allowlist configured for this repository.",
      { root, missionPath, msnId },
    );
  }

  const repoRelMission = missionPathRepoRelative(root, missionAbsolutePath);
  assertMissionUnderMissionsDir(repoRelMission);

  const scanDepth = options?.scanDepth;
  const rows = listMsnSubjectCommits(root, msnId, scanDepth);
  if (rows.length === 0) {
    throwGitProofError(
      "NO_MSN_COMMITS",
      `No commits found starting with [${msnId}]. Did you commit the mission?`,
      { root, missionPath, msnId, repoRelMission },
    );
  }

  const stamp = rows.find((r) => isTeacherEmail(r.authorEmail, teacherEmails));
  if (!stamp) {
    const latest = rows[0]!;
    throwGitProofError(
      "NO_TEACHER_MSN_COMMIT",
      `The legislation was committed by ${JSON.stringify(latest.authorEmail)}, who is not in the Teacher allowlist (${teacherIdentity.detail}). ` +
        `Add that email to .gitagent/foreman/TEACHER.allowlist.local, git config gapman.teacherEmails, or run gapman teacher set.`,
      { root, missionPath, msnId, latestAuthorEmail: latest.authorEmail },
    );
  }

  const changed = listCommitChangedPaths(root, stamp.hash);
  if (!commitTouchesMission(changed, repoRelMission)) {
    throwGitProofError(
      "MISSION_FILE_NOT_MODIFIED_BY_TEACHER",
      `The Teacher stamp for [${msnId}] is commit ${stamp.hash}: ${stamp.subject.trim()}; it did not change this mission file (${repoRelMission}). ` +
        `The stamp is the newest (scanning backward) commit authored by a Teacher allowlist email (${teacherIdentity.detail}) whose subject begins with [${msnId}]. ` +
        `Either add a newer Teacher commit with that subject that includes ${repoRelMission}, or reuse a distinct MSN whose only qualifying commits touch this file.`,
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

  return msnId;
}

/** Non-throwing git-proof check for onboarding/tutorial flows. */
export function teacherMissionStamped(
  root: string,
  missionAbsolutePath: string,
  options?: TeacherMissionProofOptions,
): boolean {
  try {
    assertTeacherMissionProof(root, missionAbsolutePath, options);
    return true;
  } catch {
    return false;
  }
}
