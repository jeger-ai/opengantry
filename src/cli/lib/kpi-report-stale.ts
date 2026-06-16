import path from "node:path";
import { toPosixRel } from "./cli-io.js";
import { gitDiffNameOnlySinceCommit, gitRunOk } from "./git-repo.js";
import { readBlamePorcelainByLine, UNCOMMITTED_BLAME_COMMIT } from "./trace-evidence.js";
import type { Manifest } from "./types.js";

export interface KpiReportStaleOptions {
  skipStaleEvidence?: boolean;
  /** When true, uncommitted TMVC drift is a hard failure (pre-push / CI). */
  strictStale?: boolean;
}

export interface KpiReportStaleResult {
  stale: boolean;
  advisoryOnly: boolean;
  stalePaths: string[];
  attestationCommit?: string;
  reason?: string;
}

function tmvcRootsForSkill(manifest: Manifest, skillKey: string | null): string[] {
  if (!skillKey?.trim()) return [];
  const skill = manifest.skills[skillKey];
  return skill ? [...skill.tmvc_roots] : [];
}

function reportRelPath(reportPath: string, repoRoot: string): string {
  const abs = path.isAbsolute(reportPath) ? reportPath : path.join(repoRoot, reportPath);
  return toPosixRel(repoRoot, abs);
}

/** Bind KPI report attestation to TMVC drift (mirrors trace-evidence committed/uncommitted split). */
export function verifyKpiReportFreshness(
  repoRoot: string,
  manifest: Manifest,
  skillKey: string | null,
  reportPath: string,
  options: KpiReportStaleOptions = {},
): KpiReportStaleResult {
  if (options.skipStaleEvidence === true) {
    return { stale: false, advisoryOnly: false, stalePaths: [] };
  }

  const tmvcRoots = tmvcRootsForSkill(manifest, skillKey);
  if (tmvcRoots.length === 0) {
    return { stale: false, advisoryOnly: false, stalePaths: [] };
  }

  const reportRel = reportRelPath(reportPath, repoRoot);
  const blameByLine = readBlamePorcelainByLine(repoRoot, reportRel);
  const attestationCommit = blameByLine.get(1);
  if (!attestationCommit) {
    return {
      stale: options.strictStale === true,
      advisoryOnly: options.strictStale !== true,
      stalePaths: [],
      reason: `cannot resolve git blame for KPI report ${reportRel}`,
    };
  }

  if (attestationCommit === UNCOMMITTED_BLAME_COMMIT) {
    return { stale: false, advisoryOnly: true, stalePaths: [], attestationCommit };
  }

  const diffResult = gitDiffNameOnlySinceCommit(repoRoot, attestationCommit, tmvcRoots);
  if (!diffResult.ok) {
    return {
      stale: options.strictStale === true,
      advisoryOnly: options.strictStale !== true,
      stalePaths: [],
      attestationCommit,
      reason: "cannot evaluate TMVC drift since KPI report attestation",
    };
  }

  if (diffResult.paths.length === 0) {
    return { stale: false, advisoryOnly: false, stalePaths: [], attestationCommit };
  }

  const shortCommit = attestationCommit.slice(0, 7);
  const shown = diffResult.paths.slice(0, 5);
  const suffix =
    diffResult.paths.length > shown.length
      ? ` (+${String(diffResult.paths.length - shown.length)} more)`
      : "";
  const reason =
    `KPI report STALE (attested at ${shortCommit}): TMVC drift since scan — ` +
    `${shown.join(", ")}${suffix}. Re-run gapman scan and commit the updated report.`;

  if (options.strictStale === true) {
    return {
      stale: true,
      advisoryOnly: false,
      stalePaths: diffResult.paths,
      attestationCommit,
      reason,
    };
  }

  return {
    stale: false,
    advisoryOnly: true,
    stalePaths: diffResult.paths,
    attestationCommit,
    reason,
  };
}

/** True when report file is tracked in git. */
export function isKpiReportCommitted(repoRoot: string, reportPath: string): boolean {
  const reportRel = reportRelPath(reportPath, repoRoot);
  const r = gitRunOk(repoRoot, ["ls-files", "--error-unmatch", reportRel]);
  return r.ok;
}
