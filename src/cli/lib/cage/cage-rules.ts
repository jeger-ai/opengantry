import fs from "node:fs";
import path from "node:path";
import { REL_MANIFEST } from "../constants.js";
import { gitRun } from "../git/git.js";
import { loadManifest } from "../manifest.js";

/**
 * Zero-config protected set for `gantry cage`. Paths are matched without any
 * manifest; manifest `forbidden_zones` are unioned in when the repo has one.
 */
export type CageRuleId = "ci_config" | "secrets" | "git_control" | "lockfile" | "manifest_forbidden_zone";

/** `revert`: restore baseline bytes and fail. `report`: list the change but keep it. */
export type CageRuleMode = "revert" | "report";

export const CAGE_RULE_MODES: Readonly<Record<CageRuleId, CageRuleMode>> = {
  ci_config: "revert",
  secrets: "revert",
  git_control: "revert",
  // Package managers legitimately rewrite lockfiles; surface the change, never undo it.
  lockfile: "report",
  manifest_forbidden_zone: "revert",
};

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
}

export interface CagePlan {
  root: string;
  targets: CageTarget[];
  manifestZoneCount: number;
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

export function buildCagePlan(root: string): CagePlan {
  const zones = manifestZoneTargets(root);
  const targets: CageTarget[] = [
    ...CI_CONFIG_PATHS.map((rel) => ({ abs: rootJoin(root, rel), rule: "ci_config" as const })),
    ...gitControlTargets(root).map((abs) => ({ abs, rule: "git_control" as const })),
    ...zones.map((abs) => ({ abs, rule: "manifest_forbidden_zone" as const })),
  ];
  return { root, targets, manifestZoneCount: zones.length };
}
