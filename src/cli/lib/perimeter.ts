import path from "node:path";
import { toPosixRel } from "./cli-io.js";
import { gitRun, gitRunOk } from "./git-repo.js";
import {
  commitSubjectHasMsnPrefix,
  listCommitChangedPaths,
  listMsnSubjectCommits,
  type MsnCommitRow,
} from "./git-proof.js";
import { resolveTeacherEmails } from "./teacher-identity.js";
import type { Manifest } from "./types.js";

export const DEFAULT_PERIMETER_PROTECTED = [
  "**/.gxt-skill.yaml",
  ".gitagent/foreman/MANIFEST.json",
  ".gitagent/teacher/RULES.md",
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

export function listChangedPathsSinceBase(repoRoot: string, baseRef: string): string[] {
  const r = gitRunOk(repoRoot, ["diff", "--name-only", `${baseRef}...HEAD`]);
  if (!r.ok) return [];
  return r.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((rel) => toPosixRel(repoRoot, path.join(repoRoot, rel)));
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
  teacherEmails: string[],
): MsnCommitRow | null {
  const rows = listMsnSubjectCommits(repoRoot, msnId);
  for (const row of rows) {
    if (!teacherEmails.includes(row.authorEmail.trim().toLowerCase())) continue;
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

export function checkPerimeter(
  repoRoot: string,
  manifest: Manifest,
  options: PerimeterCheckOptions,
): PerimeterCheckResult {
  const changed = listChangedPathsSinceBase(repoRoot, options.baseRef);
  const protectedChanged = changed.filter((p) => isPerimeterProtectedPath(p, manifest));
  if (protectedChanged.length === 0) {
    return { ok: true, violations: [], advisories: [] };
  }

  const teacherEmails = resolveTeacherEmails(repoRoot).emails;
  const violations: PerimeterViolation[] = [];
  const advisories: string[] = [];

  for (const filePath of protectedChanged) {
    const commit = lastCommitTouchingPath(repoRoot, filePath);
    if (!commit) {
      violations.push({
        path: filePath,
        commit: "unknown",
        reason: `no commit found for protected path ${filePath}`,
        advisoryOnly: options.ci !== true,
      });
      continue;
    }

    const row = commitRow(repoRoot, commit);
    if (!row) {
      violations.push({
        path: filePath,
        commit,
        reason: `cannot read commit metadata for ${commit}`,
        advisoryOnly: options.ci !== true,
      });
      continue;
    }

    if (options.ci === true) {
      const sig = signatureStatus(repoRoot, commit);
      if (!isGoodSignature(sig)) {
        violations.push({
          path: filePath,
          commit,
          reason:
            `GXT_PERIMETER_VIOLATION: protected file ${filePath} modified in unsigned commit ${commit.slice(0, 7)} ` +
            `(signature status: ${sig}). CI requires verified SSH/GPG signature.`,
          advisoryOnly: false,
        });
        continue;
      }
      advisories.push(
        `perimeter: ${filePath} touched by signed commit ${commit.slice(0, 7)} (signature ${sig})`,
      );
      continue;
    }

    const msnId = extractMsnFromRecentCommits(repoRoot, commit);
    const emailMatch =
      row.authorEmail.trim().toLowerCase() &&
      teacherEmails.includes(row.authorEmail.trim().toLowerCase());
    const subjectMatch = msnId !== null && commitSubjectHasMsnPrefix(row.subject, msnId);
    const stamp =
      msnId !== null ? findTeacherStampForPath(repoRoot, msnId, filePath, teacherEmails) : null;

    if (stamp) {
      advisories.push(
        `perimeter (advisory): ${filePath} — Teacher email + MSN stamp hint matched ${stamp.hash.slice(0, 7)} (forgeable locally; CI verifies signature)`,
      );
    } else {
      advisories.push(
        `perimeter (advisory): ${filePath} modified in ${commit.slice(0, 7)} — ` +
          `email match=${String(emailMatch)}, subject MSN match=${String(subjectMatch)}. ` +
          `Local checks are forgeable; push triggers CI signature enforcement.`,
      );
    }
  }

  const hardFailures = violations.filter((v) => !v.advisoryOnly);
  return {
    ok: hardFailures.length === 0,
    violations,
    advisories,
  };
}

/** Verify a single commit has a good signature (for CI helpers). */
export function verifyCommitSignature(repoRoot: string, hash: string): boolean {
  const r = gitRun(repoRoot, ["verify-commit", hash]);
  if (r.ok) return true;
  return isGoodSignature(signatureStatus(repoRoot, hash));
}
