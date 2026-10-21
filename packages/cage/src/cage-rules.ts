import fs from "node:fs";
import path from "node:path";
import { toPosixRel } from "#core/posix-path.js";
import { LAW_FILES, readLawFile } from "#core/law-file.js";
import { parseManifestSource } from "#core/manifest.js";
import { workingTreeReader } from "#git/repo-text.js";
import { gitRun } from "#git/git.js";
import { GantryUserError } from "#core/user-error.js";
import type { Manifest } from "#core/manifest.js";
import { judgePath, pathLaw, type PathEffect, type PathLaw, type PathLawRule } from "#core/path-law.js";
import { SECRET_ENV_EXCEPT, SECRET_ENV_PATTERNS } from "#core/secret-paths.js";
import { parseCageScopeFlag, type CageScope } from "./cage-scope.js";
import {
  CAGE_CONFIG_FILE,
  cageConfigCommitted,
  loadCageConfig,
  normalizeCageRelPath,
  type CageConfig,
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
  | "dependency_manifest"
  | "cage_config"
  | "manifest_forbidden_zone"
  | "cage_protect"
  | "out_of_scope";

/** Where a rule comes from: shipped with cage, the GXT manifest, or the project's `.cage.yaml`. */
export type CageRuleSource = "builtin" | "manifest" | "cage_yaml";

/** `revert`: restore baseline bytes and fail. `report`: list the change but keep it. */
export type CageRuleMode = "revert" | "report";

export const CAGE_RULE_MODES: Readonly<Record<CageRuleId, CageRuleMode>> = {
  ci_config: "revert",
  secrets: "revert",
  git_control: "revert",
  // Package managers legitimately rewrite lockfiles; surface the change, never undo it, unless the plan
  // freezes dependencies (`.cage.yaml` `dependencies: revert`, `--lock-deps`): see cageFloorRules.
  lockfile: "report",
  // Only ever matched when dependencies are frozen.
  dependency_manifest: "revert",
  cage_config: "revert",
  manifest_forbidden_zone: "revert",
  // Default only: each `.cage.yaml` entry carries its own mode.
  cage_protect: "revert",
  // Only ever matched when the plan has a scope (`.cage.yaml` `allow_only:`, `--allow-only`).
  out_of_scope: "revert",
};

export type { CageScope };

/** Rules `--allow-override` can never downgrade: they protect the harness itself. */
const NON_OVERRIDABLE_RULES: ReadonlySet<CageRuleId> = new Set(["git_control", "cage_config"]);

export function cageRuleSource(rule: CageRuleId): CageRuleSource {
  if (rule === "manifest_forbidden_zone") return "manifest";
  if (rule === "cage_protect") return "cage_yaml";
  return "builtin";
}

/** Root-anchored CI paths (files or directory trees). */
const CI_CONFIG_PATHS = [".github/workflows", ".gitlab-ci.yml", ".circleci", "azure-pipelines.yml"] as const;

const LOCKFILE_NAMES = [
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
] as const;

/** Dependency manifests, protected only when the plan freezes dependencies. */
const DEPENDENCY_MANIFEST_NAMES = ["package.json", "pyproject.toml", "Pipfile", "Cargo.toml", "go.mod", "Gemfile", "composer.json", "requirements*.txt"] as const;

const anywhere = (names: readonly string[]): string[] => names.map((n) => `**/${n}`);

/**
 * The built-in rules that are not path targets: secrets and lockfiles anywhere in the tree; under a dependency
 * freeze the lockfiles revert instead of report and the manifests join them (ADR-0048 decision 9). Manifests under a `vendor/` folder
 * are install output (`composer install`, `cargo vendor` write one per package), so the freeze leaves them alone.
 */
export function cageFloorRules(dependencies: CageRuleMode): PathLawRule[] {
  const rule = (id: CageRuleId, patterns: string[], mode: CageRuleMode, except?: string[]): PathLawRule => ({
    id,
    source: cageRuleSource(id),
    patterns,
    ...(except ? { except } : {}),
    effect: effectOf(mode),
    overridable: !NON_OVERRIDABLE_RULES.has(id),
  });
  const floor = [rule("secrets", [...SECRET_ENV_PATTERNS], "revert", [...SECRET_ENV_EXCEPT]), rule("lockfile", anywhere(LOCKFILE_NAMES), dependencies)];
  if (dependencies !== "revert") return floor;
  return [...floor, rule("dependency_manifest", anywhere(DEPENDENCY_MANIFEST_NAMES), "revert", ["**/vendor/**"])];
}

const effectOf = (mode: CageRuleMode): PathEffect => (mode === "revert" ? "deny" : "report");

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

/** A `.cage.yaml` glob, matched against root-relative POSIX paths (core path-glob, covering). */
export interface CageGlobTarget {
  pattern: string;
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
  /** `.cage.yaml` `contest_limit:`; null when unset (the CLI flag and the built-in default apply). */
  contestLimit: number | null;
  /** `revert` when dependencies are frozen (`.cage.yaml` `dependencies: revert` or `--lock-deps`), else `report`. */
  dependencies: CageRuleMode;
  /** The allowed area, or null when the whole repository is (no scope). */
  scope: CageScope | null;
  /** The plan's rules as one path law (ADR-0053), derived from the fields above; every classification judges it. */
  law: PathLaw;
}


/** How one path is protected after overrides; null when no rule matches. */
export interface CagePathRule {
  rule: CageRuleId;
  source: CageRuleSource;
  mode: CageRuleMode;
  overridden: boolean;
}

/**
 * The plan as a path law, in today's precedence: path targets inside the root (CI, git control, `.cage.yaml`, manifest
 * zones, `.cage.yaml` paths), the floor rules, then `.cage.yaml` globs; equal effects keep the earlier rule. Targets
 * outside the root (a linked worktree's git dir) stay capture targets the snapshot classifies itself. A scope list is
 * an area; rules come before areas, so the git dir is git_control's even outside the scope.
 */
export function cagePlanLaw(plan: Omit<CagePlan, "law">): PathLaw {
  const targets = plan.targets.flatMap((t): PathLawRule[] => {
    const rel = targetRel(plan, t);
    if (rel === null) return [];
    return [{ id: t.rule, source: t.source, patterns: [rel], effect: effectOf(t.mode), overridable: !NON_OVERRIDABLE_RULES.has(t.rule) }];
  });
  const globs = plan.globs.map((g): PathLawRule => ({ id: "cage_protect", source: g.source, patterns: [g.pattern], effect: effectOf(g.mode), overridable: true }));
  const lists = plan.scope ? [plan.scope.config, plan.scope.flag].filter((l): l is string[] => l !== null) : [];
  return pathLaw({
    rules: [...targets, ...cageFloorRules(plan.dependencies), ...globs],
    areas: lists.map((l) => ({ id: "out_of_scope", source: cageRuleSource("out_of_scope"), patterns: [...l], overridable: true })),
  });
}

function rootJoin(root: string, posixRel: string): string {
  return path.join(root, ...posixRel.split("/"));
}

/**
 * The cage root as one canonical absolute path (symlinks resolved). git reports resolved paths for
 * `.git/config`, `.git/hooks` and `core.hooksPath`, so a root reached through a symlink (every macOS temp
 * dir sits behind /var -> /private/var) would leave those targets outside the root and without their rule
 * (MSN-0265). A path that does not exist yet stays as given, absolute.
 */
export function canonicalCageRoot(root: string): string {
  const abs = path.resolve(root);
  try {
    return fs.realpathSync(abs);
  } catch {
    return abs;
  }
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

/** Union of every skill's `forbidden_zones` as sorted root-relative POSIX paths. */
export function cageManifestZones(manifest: Manifest): string[] {
  const zones = new Set<string>();
  for (const skill of Object.values(manifest.skills)) {
    for (const raw of skill.forbidden_zones ?? []) {
      const norm = raw.trim().replace(/\\/g, "/").replace(/\/+$/, "");
      if (!norm || norm.startsWith("/") || norm.split("/").includes("..")) continue;
      zones.add(norm);
    }
  }
  return [...zones].sort();
}

/**
 * Zones from the working-tree manifest when one exists. An unreadable or invalid manifest throws
 * so cage fails closed before the wrapped command runs.
 */
function manifestZones(root: string): string[] {
  const source = readLawFile(LAW_FILES.manifest, workingTreeReader(root));
  return source ? cageManifestZones(parseManifestSource(source)) : [];
}

/** `rel` equals `base` or lies inside it. */
function underPath(rel: string, base: string): boolean {
  return rel === base || rel.startsWith(`${base}/`);
}

function targetRel(plan: Pick<CagePlan, "root">, t: CageTarget): string | null {
  const rel = toPosixRel(plan.root, t.abs);
  return rel.startsWith("..") ? null : rel;
}

/**
 * The rule that decides a root-relative path (revert beats report, earlier rules win ties), after `--allow-override`.
 * Shared by the snapshot, override validation, the push guard and `cage check` so all of them agree.
 */
export function classifyCagePath(plan: Pick<CagePlan, "law" | "overrides">, rel: string, opts: { overrides?: boolean } = {}): CagePathRule | null {
  const judged = judgePath(plan.law, rel, opts.overrides === false ? [] : plan.overrides);
  if (!judged) return null;
  return { rule: judged.rule as CageRuleId, source: judged.source as CageRuleSource, mode: judged.effect === "deny" ? "revert" : "report", overridden: judged.overridden };
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
  // out_of_scope stays revert whatever a report entry says (revert beats report), so it is no downgrade.
  if (hit && hit.mode === "revert" && hit.rule !== "out_of_scope" && hit.source === "builtin") {
    throw new GantryUserError(
      "GXT_CAGE_CONFIG_INVALID",
      `cage: ${CAGE_CONFIG_FILE}: mode: report on ${value} would weaken the built-in ${hit.rule} rule`,
      "Relax a built-in rule for one run with --allow-override <path>.",
      2,
    );
  }
}

function addConfigTargets(plan: CagePlan, root: string, config: CageConfig, committed: boolean | null): void {
  for (const e of config.entries) {
    if (e.kind === "path" && e.mode === "report") assertNoBuiltinDowngrade(plan, e.value);
    if (e.kind === "path") {
      plan.targets.push({ abs: rootJoin(root, e.value), rule: "cage_protect", mode: e.mode, source: "cage_yaml" });
    } else {
      plan.globs.push({ pattern: e.value, mode: e.mode, source: "cage_yaml" });
    }
  }
  plan.config = {
    present: config.present,
    entries: config.entries.length,
    committed: config.present ? committed : null,
  };
  plan.contestLimit = config.contestLimit;
}

function builtinTarget(abs: string, rule: CageRuleId): CageTarget {
  return { abs, rule, mode: CAGE_RULE_MODES[rule], source: cageRuleSource(rule) };
}

/**
 * Rule inputs that live in the repository: manifest `forbidden_zones` (root-relative) and `.cage.yaml`.
 * The session reads them from the working tree; `gantry cage check` reads them from a commit.
 */
export interface CageRuleInputs {
  zones: readonly string[];
  config: CageConfig;
  /** Whether `.cage.yaml` is on record; ignored when it is absent. */
  configCommitted: boolean | null;
}

/** Run options that can only tighten the repo's rules. */
export interface CagePlanOptions {
  /** `--lock-deps`: freeze dependencies for this run whatever `.cage.yaml` says. */
  lockDeps?: boolean;
  /** `--allow-only <glob>`: narrow the allowed area for this run (intersected with `.cage.yaml` `allow_only:`). */
  allowOnly?: readonly string[];
}

/** Built-in floor plus the repo's rule inputs, for a canonical root. An invalid `.cage.yaml` entry throws. */
export function assembleCagePlan(root: string, inputs: CageRuleInputs, opts: CagePlanOptions = {}): CagePlan {
  const zones = inputs.zones.map((z) => rootJoin(root, z));
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
    contestLimit: null,
    // Set before the config entries so a report entry on a frozen path is refused as a downgrade.
    dependencies: opts.lockDeps === true || inputs.config.dependencies === "revert" ? "revert" : "report",
    scope: null,
    law: pathLaw(),
  };
  const flag = parseCageScopeFlag(opts.allowOnly);
  if (inputs.config.allowOnly || flag) plan.scope = { config: inputs.config.allowOnly, flag };
  // The built-in law first, so a report entry on a built-in revert path is refused as a downgrade.
  plan.law = cagePlanLaw(plan);
  addConfigTargets(plan, root, inputs.config, inputs.configCommitted);
  plan.law = cagePlanLaw(plan);
  return plan;
}

/**
 * Resolve the session's protected set from the working tree. An invalid manifest, `.cage.yaml` or
 * override throws, so cage fails closed before the wrapped command runs.
 */
export function buildCagePlan(
  givenRoot: string,
  opts: CagePlanOptions & { overrides?: readonly string[] } = {},
): CagePlan {
  const root = canonicalCageRoot(givenRoot);
  const zones = manifestZones(root);
  const config = loadCageConfig(root);
  const inputs = { zones, config, configCommitted: config.present ? cageConfigCommitted(root) : null };
  const plan = assembleCagePlan(root, inputs, { lockDeps: opts.lockDeps, allowOnly: opts.allowOnly });
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
  contestLimit?: number | null;
  dependencies?: CageRuleMode;
  scope?: CageScope | null;
}

/** JSON form for the session push guard, so it checks the exact plan the session started with. The law is derived. */
export function serializeCagePlan(plan: CagePlan): string {
  const { law: _law, ...fields } = plan;
  const out: SerializedCagePlan = { ...fields, globs: plan.globs.map((g) => ({ pattern: g.pattern, mode: g.mode, source: g.source })) };
  return JSON.stringify(out);
}

export function parseSerializedCagePlan(json: string): CagePlan {
  const p = JSON.parse(json) as SerializedCagePlan;
  const fields: Omit<CagePlan, "law"> = { ...p, contestLimit: p.contestLimit ?? null, dependencies: p.dependencies ?? "report", scope: p.scope ?? null };
  return { ...fields, law: cagePlanLaw(fields) };
}
