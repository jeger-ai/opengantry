import path from "node:path";
import { GXT_ERROR } from "./gxt-error-codes.js";
import { toPosixRel } from "./cli-io.js";
import { gitRevParse, gitRun, gitRunOk } from "./git.js";
import {
  commitSubjectHasMsnPrefix,
  listCommitChangedPaths,
  listMsnSubjectCommits,
  type MsnCommitRow,
} from "./git-proof.js";
import { resolvePlannerEmails } from "./planner-identity.js";
import type { Manifest } from "./types.js";

export const DEFAULT_PERIMETER_PROTECTED = [
  "**/.gxt-skill.yaml",
  ".gitagent/foreman/MANIFEST.json",
  ".gitagent/planner/RULES.md",
] as const;

export interface PerimeterViolation {
  path: string;
  commit: string;
  reason: string;
  advisoryOnly: boolean;
}

export interface PerimeterCheckResult {
  ok: boolean;
  violations: PerimeterViolation[];
  advisories: string[];
}

export type ChangedPathsResult =
  | { ok: true; paths: string[] }
  | { ok: false; code: string; reason: string };

const SHALLOW_HISTORY_HINT =
  "Configure CI checkout with fetch-depth: 0 or fetch the base ref explicitly before running gantry perimeter --ci.";

function perimeterGlobs(manifest: Manifest): string[] {
  return manifest.perimeter_protected?.length
    ? [...manifest.perimeter_protected]
    : [...DEFAULT_PERIMETER_PROTECTED];
}

/** Simple glob: double-star slash prefix = suffix match; otherwise exact repo-relative match. */
export function pathMatchesPerimeterGlob(repoRelPath: string, glob: string): boolean {
  const norm = repoRelPath.replace(/\\/g, "/");
  const g = glob.replace(/\\/g, "/");
  if (g.startsWith("**/")) {
    const suffix = g.slice(3);
    return norm.endsWith(suffix) || norm.includes(`/${suffix}`);
  }
  return norm === g;
}

export function isPerimeterProtectedPath(repoRelPath: string, manifest: Manifest): boolean {
  const globs = perimeterGlobs(manifest);
  return globs.some((g) => pathMatchesPerimeterGlob(repoRelPath, g));
}

function shallowHistoryReason(baseRef: string, detail: string): string {
  return (
    `${GXT_ERROR.PERIMETER_SHALLOW_HISTORY}: cannot evaluate protected-path history for ${baseRef}..HEAD — ${detail}. ` +
    SHALLOW_HISTORY_HINT
  );
}

export function listChangedPathsSinceBase(repoRoot: string, baseRef: string): ChangedPathsResult {
  if (!gitRevParse(repoRoot, baseRef)) {
    return {
      ok: false,
      code: GXT_ERROR.PERIMETER_SHALLOW_HISTORY,
      reason: shallowHistoryReason(baseRef, `base ref "${baseRef}" is missing or unreachable`),
    };
  }
  const r = gitRun(repoRoot, ["diff", "--name-only", `${baseRef}...HEAD`]);
  if (!r.ok) {
    return {
      ok: false,
      code: GXT_ERROR.PERIMETER_SHALLOW_HISTORY,
      reason: shallowHistoryReason(baseRef, r.stderr.trim() || "git diff failed"),
    };
  }
  const paths = r.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((rel) => toPosixRel(repoRoot, path.join(repoRoot, rel)));
  return { ok: true, paths };
}

export type CommitsInRangeResult =
  | { ok: true; commits: string[] }
  | { ok: false; code: string; reason: string };

/** All commits in baseRef..HEAD that touched repoRelPath (newest first). */
export function listCommitsTouchingPathInRange(
  repoRoot: string,
  baseRef: string,
  repoRelPath: string,
): CommitsInRangeResult {
  if (!gitRevParse(repoRoot, baseRef)) {
    return {
      ok: false,
      code: GXT_ERROR.PERIMETER_SHALLOW_HISTORY,
      reason: shallowHistoryReason(baseRef, `base ref "${baseRef}" is missing or unreachable`),
    };
  }
  const r = gitRun(repoRoot, ["log", "--format=%H", `${baseRef}..HEAD`, "--", repoRelPath]);
  if (!r.ok) {
    return {
      ok: false,
      code: GXT_ERROR.PERIMETER_SHALLOW_HISTORY,
      reason: shallowHistoryReason(baseRef, r.stderr.trim() || "git log failed"),
    };
  }
  const commits = r.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return { ok: true, commits };
}

function lastCommitTouchingPath(repoRoot: string, repoRelPath: string): string | null {
  const r = gitRunOk(repoRoot, ["log", "-1", "--format=%H", "HEAD", "--", repoRelPath]);
  if (!r.ok || !r.stdout.trim()) return null;
  return r.stdout.trim();
}

function commitRow(repoRoot: string, hash: string): MsnCommitRow | null {
  const r = gitRunOk(repoRoot, ["log", "-1", "--format=%H%x1f%s%x1f%aE", hash]);
  if (!r.ok) return null;
  const parts = r.stdout.trim().split("\x1f");
  if (parts.length < 3) return null;
  return { hash: parts[0]!, subject: parts[1]!, authorEmail: parts[2]! };
}

function signatureStatus(repoRoot: string, hash: string): string {
  const r = gitRunOk(repoRoot, ["log", "-1", "--format=%G?", hash]);
  if (!r.ok) return "E";
  return r.stdout.trim() || "N";
}

function isGoodSignature(status: string): boolean {
  return status === "G" || status === "U";
}

function findTeacherStampForPath(
  repoRoot: string,
  msnId: string,
  repoRelPath: string,
  plannerEmails: string[],
): MsnCommitRow | null {
  const rows = listMsnSubjectCommits(repoRoot, msnId);
  for (const row of rows) {
    if (!plannerEmails.includes(row.authorEmail.trim().toLowerCase())) continue;
    const changed = listCommitChangedPaths(repoRoot, row.hash);
    if (changed.some((p) => p.replace(/\\/g, "/") === repoRelPath.replace(/\\/g, "/"))) {
      return row;
    }
  }
  return null;
}

function extractMsnFromRecentCommits(repoRoot: string, hash: string): string | null {
  const row = commitRow(repoRoot, hash);
  if (!row) return null;
  const m = row.subject.match(/\[(MSN-\d{4})\]/);
  return m?.[1] ?? null;
}

export interface PerimeterCheckOptions {
  baseRef: string;
  /** Authoritative CI mode: require verified cryptographic signature. */
  ci?: boolean;
}

function checkProtectedPathCi(
  repoRoot: string,
  baseRef: string,
  filePath: string,
  violations: PerimeterViolation[],
  advisories: string[],
): void {
  const range = listCommitsTouchingPathInRange(repoRoot, baseRef, filePath);
  if (!range.ok) {
    violations.push({
      path: filePath,
      commit: "unknown",
      reason: range.reason,
      advisoryOnly: false,
    });
    return;
  }
  if (range.commits.length === 0) {
    violations.push({
      path: filePath,
      commit: "unknown",
      reason: `no commits in ${baseRef}..HEAD found for protected path ${filePath}`,
      advisoryOnly: false,
    });
    return;
  }
  for (const commit of range.commits) {
    const sig = signatureStatus(repoRoot, commit);
    if (!isGoodSignature(sig)) {
      violations.push({
        path: filePath,
        commit,
        reason:
          `${GXT_ERROR.PERIMETER_VIOLATION}: protected file ${filePath} modified in unsigned commit ${commit.slice(0, 7)} ` +
          `(signature status: ${sig}). CI requires verified SSH/GPG signature.`,
        advisoryOnly: false,
      });
    }
  }
  const unsignedForPath = violations.filter((v) => v.path === filePath && !v.advisoryOnly);
  if (unsignedForPath.length === 0) {
    advisories.push(
      `perimeter: ${filePath} — all ${String(range.commits.length)} commit(s) in range are signed`,
    );
  }
}

function checkProtectedPathLocal(
  repoRoot: string,
  filePath: string,
  plannerEmails: string[],
  violations: PerimeterViolation[],
  advisories: string[],
): void {
  const commit = lastCommitTouchingPath(repoRoot, filePath);
  if (!commit) {
    violations.push({
      path: filePath,
      commit: "unknown",
      reason: `no commit found for protected path ${filePath}`,
      advisoryOnly: true,
    });
    return;
  }

  const row = commitRow(repoRoot, commit);
  if (!row) {
    violations.push({
      path: filePath,
      commit,
      reason: `cannot read commit metadata for ${commit}`,
      advisoryOnly: true,
    });
    return;
  }

  const msnId = extractMsnFromRecentCommits(repoRoot, commit);
  const emailMatch =
    row.authorEmail.trim().toLowerCase() &&
    plannerEmails.includes(row.authorEmail.trim().toLowerCase());
  const subjectMatch = msnId !== null && commitSubjectHasMsnPrefix(row.subject, msnId);
  const stamp =
    msnId !== null ? findTeacherStampForPath(repoRoot, msnId, filePath, plannerEmails) : null;

  if (stamp) {
    advisories.push(
      `perimeter (advisory): ${filePath} — Planner email + MSN stamp hint matched ${stamp.hash.slice(0, 7)} (forgeable locally; CI verifies signature)`,
    );
    return;
  }
  advisories.push(
    `perimeter (advisory): ${filePath} modified in ${commit.slice(0, 7)} — ` +
      `email match=${String(emailMatch)}, subject MSN match=${String(subjectMatch)}. ` +
      `Local checks are forgeable; push triggers CI signature enforcement.`,
  );
}

export function checkPerimeter(
  repoRoot: string,
  manifest: Manifest,
  options: PerimeterCheckOptions,
): PerimeterCheckResult {
  const changedResult = listChangedPathsSinceBase(repoRoot, options.baseRef);
  if (!changedResult.ok) {
    if (options.ci === true) {
      return {
        ok: false,
        violations: [
          {
            path: "(range)",
            commit: "unknown",
            reason: changedResult.reason,
            advisoryOnly: false,
          },
        ],
        advisories: [],
      };
    }
    return { ok: true, violations: [], advisories: [changedResult.reason] };
  }

  const protectedChanged = changedResult.paths.filter((p) => isPerimeterProtectedPath(p, manifest));
  if (protectedChanged.length === 0) {
    return { ok: true, violations: [], advisories: [] };
  }

  const plannerEmails = resolvePlannerEmails(repoRoot).emails;
  const violations: PerimeterViolation[] = [];
  const advisories: string[] = [];

  for (const filePath of protectedChanged) {
    if (options.ci === true) {
      checkProtectedPathCi(repoRoot, options.baseRef, filePath, violations, advisories);
    } else {
      checkProtectedPathLocal(repoRoot, filePath, plannerEmails, violations, advisories);
    }
  }

  const hardFailures = violations.filter((v) => !v.advisoryOnly);
  return {
    ok: hardFailures.length === 0,
    violations,
    advisories,
  };
}
