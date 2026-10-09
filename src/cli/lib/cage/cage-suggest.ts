import fs from "node:fs";
import path from "node:path";
import { toPosixRel } from "../cli-io.js";
import { GantryUserError } from "../errors.js";
import { CAGE_CONFIG_FILE, type CageProtectEntry } from "./cage-config.js";
import { CAGE_SCAN_SKIP_DIRS, buildCagePlan, classifyCagePath, type CagePlan } from "./cage-rules.js";

/**
 * `gantry cage suggest`: a developer-run setup step that proposes `.cage.yaml` protect entries from
 * static heuristics. It only proposes; nothing it prints or writes is ever loaded by cage. A human
 * reviews the proposal, moves it into `.cage.yaml` and commits it.
 */
export const CAGE_SUGGESTED_FILE = `${CAGE_CONFIG_FILE}.suggested`;

/** Set by cage for the wrapped process tree; suggest refuses to run inside a session. */
export const CAGE_SESSION_ENV = "GANTRY_CAGE_SESSION";

export type CageSuggestCategory =
  | "migrations"
  | "infrastructure"
  | "container"
  | "package_registry"
  | "code_owners"
  | "ci"
  | "keys";

export interface CageSuggestion extends CageProtectEntry {
  category: CageSuggestCategory;
  reason: string;
}

export interface CageSuggestResult {
  root: string;
  suggestions: CageSuggestion[];
  /** Matches left out because built-in rules or the existing `.cage.yaml` already protect them. */
  already_covered: number;
}

interface NameRule {
  category: CageSuggestCategory;
  reason: string;
}

/** Directories protected as a whole tree when found anywhere (by exact name). */
const DIR_RULES: ReadonlyMap<string, NameRule> = new Map([
  ["migrations", { category: "migrations", reason: "database migrations" }],
  ["alembic", { category: "migrations", reason: "Alembic database migrations" }],
  ["k8s", { category: "infrastructure", reason: "Kubernetes manifests" }],
  ["kubernetes", { category: "infrastructure", reason: "Kubernetes manifests" }],
  ["helm", { category: "infrastructure", reason: "Helm charts" }],
  ["charts", { category: "infrastructure", reason: "Helm charts" }],
  [".buildkite", { category: "ci", reason: "Buildkite pipeline" }],
  [".woodpecker", { category: "ci", reason: "Woodpecker CI pipeline" }],
]);

/** Root-relative directory paths protected as a whole tree. */
const DIR_PATHS: ReadonlyMap<string, NameRule> = new Map([
  ["db/migrate", { category: "migrations", reason: "Rails database migrations" }],
  [".github/actions", { category: "ci", reason: "custom GitHub Actions run by CI" }],
]);

/** Files protected by exact basename wherever they are. */
const FILE_RULES: ReadonlyMap<string, NameRule> = new Map([
  ["Dockerfile", { category: "container", reason: "container build definition" }],
  ["docker-compose.yml", { category: "container", reason: "container runtime definition" }],
  ["docker-compose.yaml", { category: "container", reason: "container runtime definition" }],
  ["compose.yml", { category: "container", reason: "container runtime definition" }],
  ["compose.yaml", { category: "container", reason: "container runtime definition" }],
  [".npmrc", { category: "package_registry", reason: "npm registry and auth config" }],
  [".yarnrc.yml", { category: "package_registry", reason: "Yarn registry and auth config" }],
  [".pypirc", { category: "package_registry", reason: "PyPI upload credentials" }],
  ["pip.conf", { category: "package_registry", reason: "pip index config" }],
  [".gemrc", { category: "package_registry", reason: "RubyGems source config" }],
  ["CODEOWNERS", { category: "code_owners", reason: "review ownership rules" }],
  ["Jenkinsfile", { category: "ci", reason: "Jenkins pipeline" }],
  ["bitbucket-pipelines.yml", { category: "ci", reason: "Bitbucket Pipelines config" }],
  [".drone.yml", { category: "ci", reason: "Drone CI pipeline" }],
  [".travis.yml", { category: "ci", reason: "Travis CI pipeline" }],
  [".woodpecker.yml", { category: "ci", reason: "Woodpecker CI pipeline" }],
  ["cloudbuild.yaml", { category: "ci", reason: "Google Cloud Build pipeline" }],
]);

/** Extensions protected repo-wide by glob once one such file exists. */
const EXT_GLOBS: ReadonlyMap<string, NameRule> = new Map([
  [".tf", { category: "infrastructure", reason: "Terraform infrastructure" }],
  [".tfvars", { category: "infrastructure", reason: "Terraform variables (often secrets)" }],
  [".pem", { category: "keys", reason: "PEM keys and certificates" }],
  [".key", { category: "keys", reason: "private keys" }],
  [".p12", { category: "keys", reason: "PKCS#12 key stores" }],
  [".pfx", { category: "keys", reason: "PKCS#12 key stores" }],
]);

/** Build output and vendored trees: anchors found there are not the project's own. */
const SUGGEST_SKIP_DIRS: ReadonlySet<string> = new Set([...CAGE_SCAN_SKIP_DIRS, "dist", "build", "vendor", "target"]);

function dirRule(rel: string, name: string): NameRule | undefined {
  return DIR_PATHS.get(rel) ?? DIR_RULES.get(name);
}

function fileRule(name: string): NameRule | undefined {
  return FILE_RULES.get(name) ?? (name.startsWith("Dockerfile.") ? FILE_RULES.get("Dockerfile") : undefined);
}

function collect(root: string, absDir: string, found: Map<string, CageSuggestion>): void {
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const d of dirents) {
    const abs = path.join(absDir, d.name);
    const rel = toPosixRel(root, abs);
    if (d.isDirectory()) {
      if (SUGGEST_SKIP_DIRS.has(d.name)) continue;
      const rule = dirRule(rel, d.name);
      // A matched tree is suggested whole; nothing inside it needs its own entry.
      if (rule) found.set(`path:${rel}`, { kind: "path", value: rel, mode: "revert", ...rule });
      else collect(root, abs, found);
      continue;
    }
    if (!d.isFile()) continue;
    const byName = fileRule(d.name);
    if (byName) found.set(`path:${rel}`, { kind: "path", value: rel, mode: "revert", ...byName });
    const ext = path.extname(d.name);
    const byExt = EXT_GLOBS.get(ext);
    if (byExt) found.set(`glob:**/*${ext}`, { kind: "glob", value: `**/*${ext}`, mode: "revert", ...byExt });
  }
}

/** Already protected: a path the plan reverts, or a glob `.cage.yaml` already lists verbatim. */
function isCovered(plan: CagePlan, s: CageSuggestion): boolean {
  if (s.kind === "glob") return plan.globs.some((g) => g.pattern === s.value && g.mode === "revert");
  return classifyCagePath(plan, s.value, { overrides: false })?.mode === "revert";
}

function byCodePoint(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function suggestCageRules(root: string): CageSuggestResult {
  // An invalid existing .cage.yaml fails closed here too, with the same message cage would give.
  const plan = buildCagePlan(root);
  const found = new Map<string, CageSuggestion>();
  collect(root, root, found);
  const all = [...found.values()];
  const suggestions = all
    .filter((s) => !isCovered(plan, s))
    // Code-point order, so the proposal is byte-identical across machines and locales.
    .sort((a, b) => byCodePoint(a.value, b.value) || byCodePoint(a.kind, b.kind));
  return { root, suggestions, already_covered: all.length - suggestions.length };
}

/** `.cage.yaml` text for the suggestions: one reason comment per entry; parses with the cage loader. */
export function formatCageSuggestionsYaml(result: CageSuggestResult, existingConfig: boolean): string {
  const head = [
    "# Proposed by gantry cage suggest. Review every entry, then",
    existingConfig
      ? `# add the ones you want to the protect: list in ${CAGE_CONFIG_FILE} and commit it.`
      : `# save the ones you want as ${CAGE_CONFIG_FILE} and commit it.`,
    `# cage never reads this proposal.`,
  ];
  if (result.suggestions.length === 0) return `${head.join("\n")}\nprotect: []\n`;
  const body = result.suggestions.flatMap((s) => [`  # ${s.category}: ${s.reason}`, `  - ${s.kind}: ${JSON.stringify(s.value)}`]);
  return `${[...head, "protect:", ...body].join("\n")}\n`;
}

/** Write `.cage.yaml.suggested` at the root; never `.cage.yaml`. Refuses to overwrite unless forced. */
export function writeCageSuggestions(root: string, text: string, force: boolean): string {
  const file = path.join(root, CAGE_SUGGESTED_FILE);
  try {
    fs.writeFileSync(file, text, { flag: force ? "w" : "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new GantryUserError("GXT_CAGE_SUGGEST_EXISTS", `cage suggest: ${CAGE_SUGGESTED_FILE} already exists`, "Re-run with --force to replace it.", 2);
    }
    throw err;
  }
  return file;
}

/** Inside a cage session the wrapped agent must not author cage rules, not even as a proposal. */
export function assertOutsideCageSession(env: NodeJS.ProcessEnv = process.env): void {
  if (env[CAGE_SESSION_ENV]) {
    throw new GantryUserError(
      "GXT_CAGE_SUGGEST_IN_SESSION",
      "cage suggest: refused inside a cage session; run it yourself, outside gantry cage",
      undefined,
      2,
    );
  }
}
