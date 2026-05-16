import { spawnSync } from "node:child_process";
import path from "node:path";
import { CLI_NAME, MSN_ID_PATTERN } from "./constants.js";
import { extractMsnIdFromMissionPath } from "./mission-msn.js";

/** Missions verified by `gapman verify` must live under this repo-relative prefix. */
export const REL_MISSIONS_PREFIX = ".gitagent/missions/" as const;

const ENV_TEACHER_EMAILS = "GAPMAN_TEACHER_EMAILS";

const DEFAULT_MSN_SCAN_DEPTH = 200;

function gitSpawn(root: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const stdout = typeof r.stdout === "string" ? r.stdout : "";
  const stderr = typeof r.stderr === "string" ? r.stderr : "";
  return { ok: r.status === 0, stdout, stderr };
}

/** Comma-separated author emails allowed to legislate missions (case-insensitive). */
export function parseTeacherEmailsFromEnv(): string[] {
  const raw = process.env[ENV_TEACHER_EMAILS];
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
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
  return rel.split(path.sep).join("/");
}

export function assertMissionUnderMissionsDir(repoRelMissionPath: string): void {
  const norm = repoRelMissionPath.replace(/\\/g, "/");
  if (!norm.startsWith(REL_MISSIONS_PREFIX)) {
    throw new Error(
      `${CLI_NAME} verify: git-proof: MISSION_OUTSIDE_MISSIONS_DIR — mission must live under ${REL_MISSIONS_PREFIX} (got "${norm}")`,
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
  const { ok, stdout, stderr } = gitSpawn(root, [
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
  return p.trim().split(path.sep).join("/");
}

/** Paths changed in commit `hash` (repo-relative forward slashes). */
export function listCommitChangedPaths(root: string, hash: string): string[] {
  const { ok, stdout, stderr } = gitSpawn(root, ["show", "--name-only", "--pretty=format:", hash]);
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
  if (!msnId || !MSN_ID_PATTERN.test(msnId)) {
    throw new Error(
      `${CLI_NAME} verify: git-proof: MISSION_MISSING_MSN — The mission file is missing a valid [MSN-XXXX] identifier (YAML/frontmatter msn_id or msnId, line-start [MSN-NNNN], or # Mission: line).`,
    );
  }

  const teacherEmails = parseTeacherEmailsFromEnv();
  if (teacherEmails.length === 0) {
    throw new Error(
      `${CLI_NAME} verify: git-proof: TEACHER_IDENTITY_UNCONFIGURED — Set GAPMAN_TEACHER_EMAILS in your environment to define who can legislate.`,
    );
  }

  const repoRelMission = missionPathRepoRelative(root, missionAbsolutePath);
  assertMissionUnderMissionsDir(repoRelMission);

  const scanDepth = options?.scanDepth;
  const rows = listMsnSubjectCommits(root, msnId, scanDepth);
  if (rows.length === 0) {
    throw new Error(
      `${CLI_NAME} verify: git-proof: NO_MSN_COMMITS — No commits found starting with [${msnId}]. Did you commit the mission?`,
    );
  }

  const stamp = rows.find((r) => isTeacherEmail(r.authorEmail, teacherEmails));
  if (!stamp) {
    const latest = rows[0]!;
    throw new Error(
      `${CLI_NAME} verify: git-proof: NO_TEACHER_MSN_COMMIT — The legislation was committed by ${JSON.stringify(latest.authorEmail)}, who is not in the Teacher allowlist (${ENV_TEACHER_EMAILS}). ` +
        `Add that exact email (see \`git log -1 --format=%ae ${latest.hash}\`) to ${ENV_TEACHER_EMAILS}, comma-separated if several; matching is case-insensitive.`,
    );
  }

  const changed = listCommitChangedPaths(root, stamp.hash);
  if (!commitTouchesMission(changed, repoRelMission)) {
    throw new Error(
      `${CLI_NAME} verify: git-proof: MISSION_FILE_NOT_MODIFIED_BY_TEACHER — The Teacher stamp for [${msnId}] is commit ${stamp.hash}: ${stamp.subject.trim()}; it did not change this mission file (${repoRelMission}). ` +
        `The stamp is the newest (scanning backward) commit authored by ${ENV_TEACHER_EMAILS} whose subject begins with [${msnId}]. ` +
        `Either add a newer Teacher commit with that subject that includes ${repoRelMission}, or reuse a distinct MSN whose only qualifying commits touch this file.`,
    );
  }

  return msnId;
}
