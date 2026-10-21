import { REL_MANIFEST_JSON, REL_MANIFEST_YAML } from "#core/constants.js";
import { LAW_FILES, selectLawFileSource } from "#core/law-file.js";
import { parseManifestSource } from "#core/manifest.js";
import { GantryUserError, isGantryUserError } from "#core/user-error.js";
import { gitRevParse, gitRun } from "#git/git.js";
import { CAGE_CONFIG_FILE, EMPTY_CAGE_CONFIG, parseCageConfigText, type CageConfig } from "./cage-config.js";
import { changedPathsInRange } from "./cage-push-guard.js";
import { cageScopeReport } from "./cage-report.js";
import {
  assembleCagePlan,
  cageManifestZones,
  canonicalCageRoot,
  classifyCagePath,
  type CagePlan,
  type CagePlanOptions,
  type CageRuleId,
  type CageRuleMode,
  type CageRuleSource,
} from "./cage-rules.js";

export const CAGE_CHECK_SCHEMA = "gantry.cage-check.v1" as const;

/** What `gantry cage check` cannot see; printed with every result. */
export const CAGE_CHECK_LIMITS: readonly string[] = [
  "Checks committed history in base..head only: uncommitted and untracked changes are not seen.",
  "Rules come from the base commit: .cage.yaml or manifest changes in the range apply once they are merged.",
  "Paths under .git are never committed; git control shows up only for a core.hooksPath inside the repo.",
  "Not an attestation receipt: it reports which protected paths changed, not who changed them or why.",
];

export interface CageCheckChange {
  path: string;
  rule: CageRuleId;
  source: CageRuleSource;
  /** `revert`: fails the check. `report`: listed, never fails it (unfrozen lockfiles, `.cage.yaml` report entries). */
  mode: CageRuleMode;
}

/** Digest-only result of `gantry cage check`: paths and rules, never file bodies or diffs. */
export interface CageCheckReport {
  report_schema: typeof CAGE_CHECK_SCHEMA;
  status: "clean" | "violations";
  exit_code: 0 | 3;
  root: string;
  base: string;
  head: string;
  /** The commit the rules were read from (always the base). */
  rules_ref: string;
  commits: number;
  manifest_zones: number;
  cage_config: { present: boolean; entries: number };
  /** `revert` when dependencies are frozen (base `.cage.yaml` `dependencies: revert` or `--lock-deps`). */
  dependencies: CageRuleMode;
  /** Allowed-area globs (base `.cage.yaml` `allow_only:`, then `--allow-only`) and their sources; null without a scope. */
  scope: string[] | null;
  scope_sources: { cage_yaml: string[] | null; flag: string[] | null } | null;
  changes: CageCheckChange[];
  limits: readonly string[];
}

export interface CageCheckOptions {
  base: string;
  /** Default `HEAD`. */
  head?: string;
  cwd?: string;
  /** `--lock-deps`: freeze dependencies on top of the base commit's rules (only tightens). */
  lockDeps?: boolean;
  /** `--allow-only <glob>`: narrow the base commit's scope, or set one (only tightens). */
  allowOnly?: readonly string[];
}

function checkError(code: string, message: string, hint?: string): GantryUserError {
  return new GantryUserError(code, `cage check: ${message}`, hint, 2);
}

function repoRoot(cwd: string): string {
  const r = gitRun(cwd, ["rev-parse", "--show-toplevel"]);
  const top = r.stdout.trim();
  if (!r.ok || !top) {
    throw checkError("GXT_CAGE_CHECK_NOT_GIT", "not inside a git work tree", "Run it from the repository you want to check.");
  }
  return canonicalCageRoot(top);
}

function resolveRef(root: string, flag: string, ref: string): string {
  const sha = gitRevParse(root, ref);
  if (!sha) {
    throw checkError(
      "GXT_CAGE_CHECK_REF_INVALID",
      `${flag} ${ref} does not resolve to a commit`,
      "In CI, fetch full history (actions/checkout fetch-depth: 0) so the base commit is present.",
    );
  }
  return sha;
}

/** A file's text as committed at `rev`, or null when the commit does not have it. Anything else throws. */
function committedText(root: string, rev: string, rel: string): string | null {
  const type = gitRun(root, ["cat-file", "-t", `${rev}:${rel}`]);
  if (!type.ok) return null;
  const blob = type.stdout.trim() === "blob" ? gitRun(root, ["cat-file", "blob", `${rev}:${rel}`]) : null;
  if (!blob?.ok) throw checkError("GXT_CAGE_CHECK_RULES_INVALID", `${rel} at ${rev.slice(0, 12)} is not a readable file`);
  return blob.stdout;
}

function zonesAt(root: string, rev: string): string[] {
  const yaml = committedText(root, rev, REL_MANIFEST_YAML);
  const json = committedText(root, rev, REL_MANIFEST_JSON);
  if (yaml === null && json === null) return [];
  try {
    const source = selectLawFileSource(LAW_FILES.manifest, yaml, json);
    return source ? cageManifestZones(parseManifestSource(source)) : [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const rel = yaml !== null ? REL_MANIFEST_YAML : REL_MANIFEST_JSON;
    throw checkError("GXT_CAGE_CHECK_RULES_INVALID", `${rel} at ${rev.slice(0, 12)} is invalid: ${msg}`);
  }
}

function configAt(root: string, rev: string): CageConfig {
  const text = committedText(root, rev, CAGE_CONFIG_FILE);
  return text === null ? { present: false, ...EMPTY_CAGE_CONFIG } : parseCageConfigText(text);
}

/**
 * The cage rules as committed at `rev`: the built-in floor plus that commit's manifest `forbidden_zones`
 * and `.cage.yaml`. The head under review never supplies rules, so it cannot loosen its own check.
 */
export function buildCagePlanAtCommit(root: string, rev: string, opts: CagePlanOptions = {}): CagePlan {
  const zones = zonesAt(root, rev);
  const config = configAt(root, rev);
  try {
    return assembleCagePlan(root, { zones, config, configCommitted: true }, opts);
  } catch (err) {
    if (isGantryUserError(err)) throw new GantryUserError(err.code, `${err.message} (at ${rev.slice(0, 12)})`, err.hint, 2);
    throw err;
  }
}

/** Classify every path changed by commits in base..head with the rules committed at base. */
export function runCageCheck(opts: CageCheckOptions): CageCheckReport {
  const root = repoRoot(opts.cwd ?? process.cwd());
  const base = resolveRef(root, "--base", opts.base);
  const head = resolveRef(root, "--head", opts.head ?? "HEAD");
  const plan = buildCagePlanAtCommit(root, base, { lockDeps: opts.lockDeps, allowOnly: opts.allowOnly });
  const range = [`${base}..${head}`];
  const paths = changedPathsInRange(root, range);
  if (paths === null) throw checkError("GXT_CAGE_CHECK_REF_INVALID", `git log ${base.slice(0, 12)}..${head.slice(0, 12)} failed`);
  const count = gitRun(root, ["rev-list", "--count", ...range]);

  const changes: CageCheckChange[] = [];
  for (const rel of paths) {
    const hit = classifyCagePath(plan, rel, { overrides: false });
    if (hit) changes.push({ path: rel, rule: hit.rule, source: hit.source, mode: hit.mode });
  }
  changes.sort((a, b) => a.path.localeCompare(b.path));
  const failed = changes.some((c) => c.mode === "revert");
  return {
    report_schema: CAGE_CHECK_SCHEMA,
    status: failed ? "violations" : "clean",
    exit_code: failed ? 3 : 0,
    root,
    base,
    head,
    rules_ref: base,
    commits: count.ok ? Number.parseInt(count.stdout.trim(), 10) || 0 : 0,
    manifest_zones: plan.manifestZoneCount,
    cage_config: { present: plan.config.present, entries: plan.config.entries },
    dependencies: plan.dependencies,
    ...cageScopeReport(plan.scope),
    changes,
    limits: CAGE_CHECK_LIMITS,
  };
}

/** Human summary for stderr. */
export function formatCageCheckReport(r: CageCheckReport): string[] {
  const short = (sha: string): string => sha.slice(0, 12);
  const row = (c: CageCheckChange): string => `  ${c.path}  ${c.rule} (${c.source})`;
  const failing = r.changes.filter((c) => c.mode === "revert");
  const reported = r.changes.filter((c) => c.mode === "report");
  const frozen = [
    r.dependencies === "revert" ? "; dependencies frozen" : "",
    r.scope ? `; scope: ${r.scope.join(", ")}` : "",
  ].join("");
  const lines = [`cage check: ${String(r.commits)} commit(s) in ${short(r.base)}..${short(r.head)}; rules from ${short(r.rules_ref)}${frozen}`];
  if (failing.length > 0) lines.push("cage check: protected paths changed:", ...failing.map(row));
  if (reported.length > 0) lines.push("cage check: reported only (does not fail the check):", ...reported.map(row));
  lines.push(
    failing.length > 0
      ? `cage check: FAIL: ${String(failing.length)} protected path(s) changed (exit 3); review them before merging`
      : "cage check: OK: no protected path changed",
  );
  lines.push("cage check: limits:", ...r.limits.map((l) => `  - ${l}`));
  return lines;
}
