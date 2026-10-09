import fs from "node:fs";
import path from "node:path";
import { toPosixRel } from "../cli-io.js";
import { REL_MANIFEST } from "../constants.js";
import { gitRun } from "../git/git.js";
import { GantryUserError } from "../errors.js";
import { loadManifest } from "../manifest.js";
import {
  CAGE_CONFIG_FILE,
  cageConfigCommitted,
  cageGlobToRegExp,
  loadCageConfig,
  normalizeCageRelPath,
} from "./cage-config.js";

/**
 * Zero-config protected set for `gantry cage`. Paths are matched without any
 * manifest; manifest `forbidden_zones` and `.cage.yaml` `protect:` entries are
 * unioned in when present. Nothing in the repo can remove a built-in rule.
 */
export type CageRuleId =
  | "ci_config"
  | "secrets"
  | "git_control"
  | "lockfile"
  | "cage_config"
  | "manifest_forbidden_zone"
  | "cage_protect";

/** Where a rule comes from: shipped with cage, the GXT manifest, or the project's `.cage.yaml`. */
export type CageRuleSource = "builtin" | "manifest" | "cage_yaml";

/** `revert`: restore baseline bytes and fail. `report`: list the change but keep it. */
export type CageRuleMode = "revert" | "report";

export const CAGE_RULE_MODES: Readonly<Record<CageRuleId, CageRuleMode>> = {
  ci_config: "revert",
  secrets: "revert",
  git_control: "revert",
  // Package managers legitimately rewrite lockfiles; surface the change, never undo it.
  lockfile: "report",
  cage_config: "revert",
  manifest_forbidden_zone: "revert",
  // Default only: each `.cage.yaml` entry carries its own mode.
  cage_protect: "revert",
};

/** Rules `--allow-override` can never downgrade: they protect the harness itself. */
const NON_OVERRIDABLE_RULES: ReadonlySet<CageRuleId> = new Set(["git_control", "cage_config"]);

export function cageRuleSource(rule: CageRuleId): CageRuleSource {
  if (rule === "manifest_forbidden_zone") return "manifest";
  if (rule === "cage_protect") return "cage_yaml";
  return "builtin";
}

/** Root-anchored CI paths (files or directory trees). */
const CI_CONFIG_PATHS = [".github/workflows", ".gitlab-ci.yml", ".circleci", "azure-pipelines.yml"] as const;

const LOCKFILE_NAMES: ReadonlySet<string> = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "go.sum",
  "Gemfile.lock",
  "composer.lock",
]);

/** Directory names skipped by the whole-tree basename scan (dependency and VCS bulk). */
export const CAGE_SCAN_SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".venv",
  "venv",
  "__pycache__",
]);

/** A file or directory tree protected by absolute path. */
export interface CageTarget {
  abs: string;
  rule: CageRuleId;
  mode: CageRuleMode;
  source: CageRuleSource;
}

/** A `.cage.yaml` glob, matched against root-relative POSIX paths found by the whole-tree scan. */
export interface CageGlobTarget {
  pattern: string;
  re: RegExp;
  mode: CageRuleMode;
  source: "cage_yaml";
}

export interface CagePlan {
  root: string;
  targets: CageTarget[];
  globs: CageGlobTarget[];
  /** Root-relative paths whose revert rules `--allow-override` downgraded to report. */
  overrides: string[];
  manifestZoneCount: number;
  /** `committed` is null when there is no config or no git work tree. */
  config: { present: boolean; entries: number; committed: boolean | null };
}

/** How one path is protected after overrides; null when no rule matches. */
export interface CagePathRule {
  rule: CageRuleId;
  mode: CageRuleMode;
  overridden: boolean;
}

/** Rule for a file found by the whole-tree scan, keyed on its basename. */
export function cageBasenameRule(name: string): CageRuleId | null {
  if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) return "secrets";
  if (LOCKFILE_NAMES.has(name)) return "lockfile";
  return null;
}

function rootJoin(root: string, posixRel: string): string {
  return path.join(root, ...posixRel.split("/"));
}

function gitPathAbs(root: string, args: string[]): string | null {
  const r = gitRun(root, ["rev-parse", "--path-format=absolute", ...args]);
  const out = r.stdout.trim();
  return r.ok && out ? out : null;
}

/** `.git/config`, `.git/hooks/`, and the active `core.hooksPath` when it differs. */
function gitControlTargets(root: string): string[] {
  const common = gitPathAbs(root, ["--git-common-dir"]);
  if (!common) return [];
  const out = [path.join(common, "config"), path.join(common, "hooks")];
  const activeHooks = gitPathAbs(root, ["--git-path", "hooks"]);
  if (activeHooks) out.push(activeHooks);
  return [...new Set(out.map((p) => path.resolve(p)))];
}

/**
 * Union of every skill's `forbidden_zones` when a manifest exists. An unreadable or
 * invalid manifest throws so cage fails closed before the wrapped command runs.
 */
function manifestZoneTargets(root: string): string[] {
  if (!fs.existsSync(rootJoin(root, REL_MANIFEST))) return [];
  const manifest = loadManifest(root);
  const zones = new Set<string>();
  for (const skill of Object.values(manifest.skills)) {
    for (const raw of skill.forbidden_zones ?? []) {
      const norm = raw.trim().replace(/\\/g, "/").replace(/\/+$/, "");
      if (!norm || norm.startsWith("/") || norm.split("/").includes("..")) continue;
      zones.add(norm);
    }
  }
  return [...zones].sort().map((z) => rootJoin(root, z));
}

/** `rel` equals `base` or lies inside it. */
function underPath(rel: string, base: string): boolean {
  return rel === base || rel.startsWith(`${base}/`);
}

function targetRel(plan: Pick<CagePlan, "root">, t: CageTarget): string | null {
  const rel = toPosixRel(plan.root, t.abs);
  return rel.startsWith("..") ? null : rel;
}

function stricter(a: CagePathRule | null, b: CagePathRule): CagePathRule {
  return a && (a.mode === "revert" || b.mode === "report") ? a : b;
}

function isOverridden(plan: Pick<CagePlan, "overrides">, rel: string): boolean {
  return plan.overrides.some((o) => underPath(rel, o));
}

/**
 * The strictest rule for a root-relative path (revert beats report), then `--allow-override`.
 * Shared by the snapshot, override validation and the push guard so all three agree.
 */
export function classifyCagePath(plan: CagePlan, rel: string, opts: { overrides?: boolean } = {}): CagePathRule | null {
  let hit: CagePathRule | null = null;
  for (const t of plan.targets) {
    const base = targetRel(plan, t);
    if (base !== null && underPath(rel, base)) hit = stricter(hit, { rule: t.rule, mode: t.mode, overridden: false });
  }
  const byName = cageBasenameRule(path.posix.basename(rel));
  if (byName) hit = stricter(hit, { rule: byName, mode: CAGE_RULE_MODES[byName], overridden: false });
  for (const g of plan.globs) {
    if (g.re.test(rel)) hit = stricter(hit, { rule: "cage_protect", mode: g.mode, overridden: false });
  }
  return applyCageOverride(plan, rel, hit, opts.overrides !== false);
}

/** Downgrade a revert rule to report when the path is overridden; harness rules never are. */
export function applyCageOverride(
  plan: Pick<CagePlan, "overrides">,
  rel: string,
  hit: CagePathRule | null,
  enabled = true,
): CagePathRule | null {
  if (!enabled || !hit || hit.mode !== "revert" || NON_OVERRIDABLE_RULES.has(hit.rule)) return hit;
  return isOverridden(plan, rel) ? { ...hit, mode: "report", overridden: true } : hit;
}

function overrideError(message: string): GantryUserError {
  return new GantryUserError("GXT_CAGE_OVERRIDE_INVALID", `cage: --allow-override ${message}`, undefined, 2);
}

function overlaps(a: string, b: string): boolean {
  return underPath(a, b) || underPath(b, a);
}

/** Reject overrides that touch harness rules or that match no revert target; returns them normalized. */
function validateOverrides(plan: CagePlan, raw: readonly string[]): string[] {
  const out = new Set<string>();
  for (const r of raw) {
    const o = normalizeCageRelPath(r);
    if (!o) throw overrideError(`${r}: expected a root-relative path without ".." or a leading "/"`);
    const harness = plan.targets.find((t) => {
      const base = targetRel(plan, t);
      return NON_OVERRIDABLE_RULES.has(t.rule) && base !== null && overlaps(o, base);
    });
    if (harness) throw overrideError(`${o}: ${harness.rule} rules cannot be overridden`);
    const direct = classifyCagePath(plan, o, { overrides: false })?.mode === "revert";
    const parent = plan.targets.some((t) => {
      const base = targetRel(plan, t);
      return t.mode === "revert" && base !== null && underPath(base, o);
    });
    if (!direct && !parent) throw overrideError(`${o}: matches no protected revert target`);
    out.add(o);
  }
  return [...out].sort();
}

/** Report mode on a path a built-in rule already reverts would read as a relaxation; refuse it. */
function assertNoBuiltinDowngrade(plan: CagePlan, value: string): void {
  const hit = classifyCagePath(plan, value, { overrides: false });
  if (hit && hit.mode === "revert" && cageRuleSource(hit.rule) === "builtin") {
    throw new GantryUserError(
      "GXT_CAGE_CONFIG_INVALID",
      `cage: ${CAGE_CONFIG_FILE}: mode: report on ${value} would weaken the built-in ${hit.rule} rule`,
      "Relax a built-in rule for one run with --allow-override <path>.",
      2,
    );
  }
}

function addConfigTargets(plan: CagePlan, root: string): number {
  const config = loadCageConfig(root);
  for (const e of config.entries) {
    if (e.kind === "path" && e.mode === "report") assertNoBuiltinDowngrade(plan, e.value);
    if (e.kind === "path") {
      plan.targets.push({ abs: rootJoin(root, e.value), rule: "cage_protect", mode: e.mode, source: "cage_yaml" });
    } else {
      plan.globs.push({ pattern: e.value, re: cageGlobToRegExp(e.value), mode: e.mode, source: "cage_yaml" });
    }
  }
  plan.config = {
    present: config.present,
    entries: config.entries.length,
    committed: config.present ? cageConfigCommitted(root) : null,
  };
  return config.entries.length;
}

function builtinTarget(abs: string, rule: CageRuleId): CageTarget {
  return { abs, rule, mode: CAGE_RULE_MODES[rule], source: cageRuleSource(rule) };
}

/**
 * Resolve the session's protected set. An invalid manifest, `.cage.yaml` or override throws, so cage
 * fails closed before the wrapped command runs.
 */
export function buildCagePlan(root: string, opts: { overrides?: readonly string[] } = {}): CagePlan {
  const zones = manifestZoneTargets(root);
  const plan: CagePlan = {
    root,
    targets: [
      ...CI_CONFIG_PATHS.map((rel) => builtinTarget(rootJoin(root, rel), "ci_config")),
      ...gitControlTargets(root).map((abs) => builtinTarget(abs, "git_control")),
      // Always protected, present or not: an in-session edit is restored and a new file is removed.
      builtinTarget(rootJoin(root, CAGE_CONFIG_FILE), "cage_config"),
      ...zones.map((abs) => builtinTarget(abs, "manifest_forbidden_zone")),
    ],
    globs: [],
    overrides: [],
    manifestZoneCount: zones.length,
    config: { present: false, entries: 0, committed: null },
  };
  addConfigTargets(plan, root);
  plan.overrides = validateOverrides(plan, opts.overrides ?? []);
  return plan;
}

interface SerializedCagePlan {
  root: string;
  targets: CageTarget[];
  globs: { pattern: string; mode: CageRuleMode; source: "cage_yaml" }[];
  overrides: string[];
  manifestZoneCount: number;
  config: CagePlan["config"];
}

/** JSON form for the session push guard, so it checks the exact plan the session started with. */
export function serializeCagePlan(plan: CagePlan): string {
  const out: SerializedCagePlan = { ...plan, globs: plan.globs.map((g) => ({ pattern: g.pattern, mode: g.mode, source: g.source })) };
  return JSON.stringify(out);
}

export function parseSerializedCagePlan(json: string): CagePlan {
  const p = JSON.parse(json) as SerializedCagePlan;
  return { ...p, globs: p.globs.map((g) => ({ ...g, re: cageGlobToRegExp(g.pattern) })) };
}
