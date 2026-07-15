import fs from "node:fs";
import path from "node:path";
import { gitRunOk } from "./git.js";
import { normalizeRepoRelativePath } from "./tmvc-path.js";
import { loadGxtConfig } from "./gxt-config.js";
import {
  resolveDefensiveProfile,
  type GuardSeverity,
  type ResolvedDefensiveProfile,
} from "./defensive-profile.js";
import type { Manifest } from "./types.js";
import { resolveManifestSkillKey } from "./skill-key.js";

export interface DefensiveFinding {
  guard: string;
  severity: GuardSeverity;
  message: string;
  detail?: Record<string, string | number>;
}

export interface DefensiveGuardResult {
  ok: boolean;
  findings: DefensiveFinding[];
  blocked: DefensiveFinding[];
  warnings: DefensiveFinding[];
  audits: DefensiveFinding[];
  net_loc?: number;
  max_net_loc?: number;
  /** Hard evaluation error (e.g. unknown skill) — never a guard finding message. */
  error?: string;
}

interface FileNumstat {
  path: string;
  additions: number;
  deletions: number;
}

function gitNumstatLines(repoRoot: string, args: string[]): FileNumstat[] {
  const { ok, stdout } = gitRunOk(repoRoot, args);
  if (!ok) return [];
  const rows: FileNumstat[] = [];
  for (const line of stdout.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const add = parts[0] === "-" ? 0 : Number.parseInt(parts[0] ?? "0", 10);
    const del = parts[1] === "-" ? 0 : Number.parseInt(parts[1] ?? "0", 10);
    const filePath = parts[2]?.trim();
    if (!filePath) continue;
    rows.push({
      path: normalizeRepoRelativePath(filePath),
      additions: Number.isFinite(add) ? add : 0,
      deletions: Number.isFinite(del) ? del : 0,
    });
  }
  return rows;
}

function pathMatchesTmvcRoot(filePath: string, roots: readonly string[]): boolean {
  const norm = normalizeRepoRelativePath(filePath);
  return roots.some((root) => {
    const r = normalizeRepoRelativePath(root);
    return norm === r || norm.startsWith(`${r.replace(/\/$/, "")}/`);
  });
}

/** Changed files under TMVC roots (worktree + staged vs HEAD). */
export function listChangedFilesInTmvc(repoRoot: string, tmvcRoots: readonly string[]): string[] {
  const { ok, stdout } = gitRunOk(repoRoot, ["diff", "--name-only", "HEAD"]);
  if (!ok) return [];
  const staged = gitRunOk(repoRoot, ["diff", "--name-only", "--cached"]);
  const lines = new Set<string>();
  for (const chunk of [stdout, staged.ok ? staged.stdout : ""]) {
    for (const line of chunk.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (pathMatchesTmvcRoot(trimmed, tmvcRoots)) {
        lines.add(normalizeRepoRelativePath(trimmed));
      }
    }
  }
  return [...lines];
}

function numstatForTmvcFiles(repoRoot: string, tmvcRoots: readonly string[]): FileNumstat[] {
  const changed = listChangedFilesInTmvc(repoRoot, tmvcRoots);
  if (changed.length === 0) return [];
  const pathArgs = changed.flatMap((f) => ["--", f]);
  const worktree = gitNumstatLines(repoRoot, ["diff", "--numstat", "HEAD", ...pathArgs]);
  const staged = gitNumstatLines(repoRoot, ["diff", "--numstat", "--cached", ...pathArgs]);
  const merged = new Map<string, FileNumstat>();
  for (const row of [...worktree, ...staged]) {
    const prev = merged.get(row.path);
    if (prev) {
      merged.set(row.path, {
        path: row.path,
        additions: prev.additions + row.additions,
        deletions: prev.deletions + row.deletions,
      });
    } else {
      merged.set(row.path, row);
    }
  }
  return [...merged.values()];
}

/** Net LOC across worktree + staged diffs for the given repo-relative paths. */
export function computeNetLocForFiles(repoRoot: string, files: readonly string[]): number {
  if (files.length === 0) return 0;
  const relFiles = files.map((f) => normalizeRepoRelativePath(f));
  const pathArgs = relFiles.flatMap((f) => ["--", f]);
  let total = 0;
  for (const row of gitNumstatLines(repoRoot, ["diff", "--numstat", "HEAD", ...pathArgs])) {
    total += row.additions + row.deletions;
  }
  for (const row of gitNumstatLines(repoRoot, ["diff", "--numstat", "--cached", ...pathArgs])) {
    total += row.additions + row.deletions;
  }
  return total;
}

function baselineLineCount(repoRoot: string, filePath: string): number {
  const { ok, stdout } = gitRunOk(repoRoot, ["show", `HEAD:${filePath}`]);
  if (!ok || !stdout) return 0;
  return stdout.split("\n").length;
}

const ASSERTION_TOKEN_RE =
  /\bassert\.[a-zA-Z_][\w.]*|\bexpect\s*\(|\bassertEqual\b|\bassert\.strictEqual\b|\bassert\.deepStrictEqual\b/g;

export function countAssertionTokens(source: string): number {
  const matches = source.match(ASSERTION_TOKEN_RE);
  return matches?.length ?? 0;
}

function isTestFilePath(filePath: string): boolean {
  const norm = normalizeRepoRelativePath(filePath);
  return (
    /\.test\.[cm]?[jt]sx?$/.test(norm) ||
    /\.spec\.[cm]?[jt]sx?$/.test(norm) ||
    norm.includes("/__tests__/")
  );
}

function fileSourceAtHead(repoRoot: string, filePath: string): string {
  const { ok, stdout } = gitRunOk(repoRoot, ["show", `HEAD:${filePath}`]);
  return ok ? stdout : "";
}

function fileSourceWorking(repoRoot: string, filePath: string): string {
  const { ok, stdout } = gitRunOk(repoRoot, ["show", `:${filePath}`]);
  if (ok) return stdout;
  try {
    const abs = path.join(repoRoot, filePath);
    if (!fs.existsSync(abs)) return "";
    return fs.readFileSync(abs, "utf8");
  } catch {
    return "";
  }
}

function evaluateNetLocBudget(
  profile: ResolvedDefensiveProfile,
  netLoc: number,
): DefensiveFinding[] {
  const guard = profile.net_loc_budget;
  if (!guard) return [];
  const max = guard.config.max_net_loc;
  if (netLoc <= max) return [];
  return [
    {
      guard: "net_loc_budget",
      severity: guard.severity,
      message: `net_loc ${netLoc} exceeds defensive_profile max_net_loc ${max}`,
      detail: { net_loc: netLoc, max_net_loc: max },
    },
  ];
}

function evaluateFileScope(
  profile: ResolvedDefensiveProfile,
  fileCount: number,
): DefensiveFinding[] {
  const guard = profile.file_scope;
  if (!guard) return [];
  const max = guard.config.max_files;
  if (fileCount <= max) return [];
  return [
    {
      guard: "file_scope",
      severity: guard.severity,
      message: `touched ${fileCount} TMVC files exceeds defensive_profile max_files ${max}`,
      detail: { files_touched: fileCount, max_files: max },
    },
  ];
}

function evaluateChurnRatio(
  repoRoot: string,
  profile: ResolvedDefensiveProfile,
  rows: readonly FileNumstat[],
): DefensiveFinding[] {
  const guard = profile.churn_ratio;
  if (!guard) return [];
  const maxRatio = guard.config.max_ratio;
  const findings: DefensiveFinding[] = [];
  for (const row of rows) {
    const changed = row.additions + row.deletions;
    if (changed === 0) continue;
    const baseline = baselineLineCount(repoRoot, row.path);
    const denom = Math.max(baseline, changed, 1);
    const ratio = changed / denom;
    if (ratio > maxRatio) {
      findings.push({
        guard: "churn_ratio",
        severity: guard.severity,
        message: `churn ratio ${ratio.toFixed(2)} for ${row.path} exceeds max_ratio ${maxRatio}`,
        detail: {
          path: row.path,
          churn_ratio: Math.round(ratio * 1000) / 1000,
          max_ratio: maxRatio,
        },
      });
    }
  }
  if (rows.length === 0) return findings;
  const totalChanged = rows.reduce((s, r) => s + r.additions + r.deletions, 0);
  if (totalChanged === 0) return findings;
  const totalBaseline = rows.reduce((s, r) => s + baselineLineCount(repoRoot, r.path), 0);
  const aggregateRatio = totalChanged / Math.max(totalBaseline, totalChanged, 1);
  if (aggregateRatio > maxRatio) {
    findings.push({
      guard: "churn_ratio",
      severity: guard.severity,
      message: `mission aggregate churn ratio ${aggregateRatio.toFixed(2)} exceeds max_ratio ${maxRatio}`,
      detail: {
        churn_ratio: Math.round(aggregateRatio * 1000) / 1000,
        max_ratio: maxRatio,
      },
    });
  }
  return findings;
}

function evaluateTestToCode(
  repoRoot: string,
  profile: ResolvedDefensiveProfile,
  rows: readonly FileNumstat[],
): DefensiveFinding[] {
  const guard = profile.test_to_code;
  if (!guard) return [];
  const minDelta = guard.config.min_assertion_delta;

  let assertionDelta = 0;
  for (const row of rows) {
    if (!isTestFilePath(row.path)) continue;
    const before = countAssertionTokens(fileSourceAtHead(repoRoot, row.path));
    const after = countAssertionTokens(fileSourceWorking(repoRoot, row.path));
    assertionDelta += after - before;
  }

  const nonTestNetLoc = rows
    .filter((r) => !isTestFilePath(r.path))
    .reduce((s, r) => s + r.additions + r.deletions, 0);

  if (nonTestNetLoc > 0 && assertionDelta < minDelta) {
    return [
      {
        guard: "test_to_code",
        severity: guard.severity,
        message: `assertion delta ${assertionDelta} below min_assertion_delta ${minDelta} while non-test LOC changed by ${nonTestNetLoc}`,
        detail: {
          assertion_delta: assertionDelta,
          min_assertion_delta: minDelta,
          non_test_net_loc: nonTestNetLoc,
        },
      },
    ];
  }
  return [];
}

function hasActiveGuards(profile: ResolvedDefensiveProfile): boolean {
  return (
    profile.net_loc_budget != null ||
    profile.file_scope != null ||
    profile.churn_ratio != null ||
    profile.test_to_code != null
  );
}

export function evaluateDefensiveGuards(
  repoRoot: string,
  manifest: Manifest,
  skillKey: string,
): DefensiveGuardResult {
  const profile = resolveDefensiveProfile(loadGxtConfig(repoRoot));
  const empty: DefensiveGuardResult = {
    ok: true,
    findings: [],
    blocked: [],
    warnings: [],
    audits: [],
  };
  if (!profile.enabled || !hasActiveGuards(profile)) {
    return empty;
  }

  const resolvedKey = resolveManifestSkillKey(manifest, skillKey);
  const skill = manifest.skills[resolvedKey];
  if (!skill) {
    return {
      ok: false,
      findings: [],
      blocked: [],
      warnings: [],
      audits: [],
      error: `defensive guard: unknown skill ${skillKey}`,
    };
  }

  const tmvcRoots = skill.tmvc_roots ?? [];
  const changed = listChangedFilesInTmvc(repoRoot, tmvcRoots);
  const rows = numstatForTmvcFiles(repoRoot, tmvcRoots);
  const netLoc = computeNetLocForFiles(repoRoot, changed);

  const findings: DefensiveFinding[] = [
    ...evaluateNetLocBudget(profile, netLoc),
    ...evaluateFileScope(profile, changed.length),
    ...evaluateChurnRatio(repoRoot, profile, rows),
    ...evaluateTestToCode(repoRoot, profile, rows),
  ];
  const blocked = findings.filter((f) => f.severity === "block");
  const warnings = findings.filter((f) => f.severity === "warn");
  const audits = findings.filter((f) => f.severity === "audit");

  return {
    ok: blocked.length === 0,
    findings,
    blocked,
    warnings,
    audits,
    net_loc: netLoc,
    ...(profile.net_loc_budget ? { max_net_loc: profile.net_loc_budget.config.max_net_loc } : {}),
  };
}
