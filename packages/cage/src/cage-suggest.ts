import fs from "node:fs";
import path from "node:path";
import { toPosixRel } from "#core/posix-path.js";
import { SECRET_ANYWHERE_PATTERNS, SECRET_HOME_PATTERNS } from "#core/secret-paths.js";
import { GantryUserError } from "#core/user-error.js";
import { CAGE_CONFIG_FILE, normalizeCageRelPath, type CageProtectEntry } from "./cage-config.js";
import { CAGE_SCAN_SKIP_DIRS, buildCagePlan, classifyCagePath, type CagePlan } from "./cage-rules.js";

/**
 * The developer-run setup steps. `gantry cage suggest` proposes `.cage.yaml` protect entries from static heuristics;
 * `gantry cage policy` writes the cage's law as an agent's own sandbox settings (ADR-0060). Both only propose: cage
 * never loads what they print or write. A human reviews it, moves it in place and commits it.
 */
export const CAGE_SUGGESTED_FILE = `${CAGE_CONFIG_FILE}.suggested`;

/** Set by cage for the wrapped process tree; suggest refuses to run inside a session. */
export const CAGE_SESSION_ENV = "GANTRY_CAGE_SESSION";

type CageSuggestCategory = "migrations" | "infrastructure" | "container" | "package_registry" | "code_owners" | "ci" | "git_hooks" | "keys";

interface NameRule {
  category: CageSuggestCategory;
  reason: string;
}

export interface CageSuggestion extends CageProtectEntry, NameRule {}

export interface CageSuggestResult {
  root: string;
  suggestions: CageSuggestion[];
  /** Matches left out because built-in rules or the existing `.cage.yaml` already protect them. */
  already_covered: number;
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
  [".githooks", { category: "git_hooks", reason: "committed git hooks (run on commit and push)" }],
  [".husky", { category: "git_hooks", reason: "Husky git hooks (run on commit and push)" }],
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
  [".pre-commit-config.yaml", { category: "git_hooks", reason: "pre-commit hook config" }],
  ["lefthook.yml", { category: "git_hooks", reason: "Lefthook git hook config" }],
  ["lefthook.yaml", { category: "git_hooks", reason: "Lefthook git hook config" }],
  [".lefthook.yml", { category: "git_hooks", reason: "Lefthook git hook config" }],
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

const dirRule = (rel: string, name: string): NameRule | undefined => DIR_PATHS.get(rel) ?? DIR_RULES.get(name);
const fileRule = (name: string): NameRule | undefined => FILE_RULES.get(name) ?? (name.startsWith("Dockerfile.") ? FILE_RULES.get("Dockerfile") : undefined);

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

/** Code-point order, so output is byte-identical across machines and locales. */
const byCodePoint = (a: string, b: string): number => (a === b ? 0 : a < b ? -1 : 1);

export function suggestCageRules(givenRoot: string): CageSuggestResult {
  // An invalid existing .cage.yaml fails closed here too, with the same message cage would give.
  const plan = buildCagePlan(givenRoot);
  // The plan's root is canonical (MSN-0265); scan from it so found paths and plan targets share one base.
  const root = plan.root;
  const found = new Map<string, CageSuggestion>();
  collect(root, root, found);
  const all = [...found.values()];
  const suggestions = all.filter((s) => !isCovered(plan, s)).sort((a, b) => byCodePoint(a.value, b.value) || byCodePoint(a.kind, b.kind));
  return { root, suggestions, already_covered: all.length - suggestions.length };
}

/** `.cage.yaml` text for the suggestions: one reason comment per entry; parses with the cage loader. */
export function formatCageSuggestionsYaml(result: CageSuggestResult, existingConfig: boolean): string {
  const then = existingConfig ? `add the ones you want to the protect: list in ${CAGE_CONFIG_FILE}` : `save the ones you want as ${CAGE_CONFIG_FILE}`;
  const head = ["# Proposed by gantry cage suggest. Review every entry, then", `# ${then} and commit it.`, "# cage never reads this proposal."];
  if (result.suggestions.length === 0) return `${head.join("\n")}\nprotect: []\n`;
  const body = result.suggestions.flatMap((s) => [`  # ${s.category}: ${s.reason}`, `  - ${s.kind}: ${JSON.stringify(s.value)}`]);
  return `${[...head, "protect:", ...body].join("\n")}\n`;
}

/** Write a setup step's file (`suggest --write`, `policy --out`); never `.cage.yaml`. Refuses to overwrite unless forced. */
export function writeCageSetupFile(file: string, text: string, force: boolean, step: "suggest" | "policy"): string {
  try {
    fs.writeFileSync(file, text, { flag: force ? "w" : "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      const code = step === "policy" ? "GXT_CAGE_POLICY_EXISTS" : "GXT_CAGE_SUGGEST_EXISTS";
      throw new GantryUserError(code, `cage ${step}: ${path.basename(file)} already exists`, "Re-run with --force to replace it.", 2);
    }
    throw err;
  }
  return file;
}

/** Inside a cage session the wrapped agent must not author cage rules or its own sandbox, not even as a proposal. */
export function assertOutsideCageSession(env: NodeJS.ProcessEnv = process.env, step: "suggest" | "policy" = "suggest"): void {
  const code = step === "policy" ? "GXT_CAGE_POLICY_IN_SESSION" : "GXT_CAGE_SUGGEST_IN_SESSION";
  if (env[CAGE_SESSION_ENV]) throw new GantryUserError(code, `cage ${step}: refused inside a cage session; run it yourself, outside gantry cage`, undefined, 2);
}

/** A literal last segment may name a directory, and Claude Code documents a tree as `dir/**`: deny both forms. */
const covering = (p: string): string[] => (p.slice(p.lastIndexOf("/") + 1).includes("*") ? [p] : [p, `${p}/**`]);
/** A root-relative law pattern as a permission path: `/` anchors it at the project root, `**` patterns match at any depth. */
const permissionPath = (p: string): string => (p.startsWith("**/") ? p : `/${p}`);

/**
 * `gantry cage policy --agent claude-code` (ADR-0060): the cage's revert rules, a contract's `forbidden_paths` and the read
 * guard's secrets as Claude Code settings. `Edit(...)` covers every edit tool (a `Write(...)` rule never matches); the file
 * tools obey `permissions`, Bash and its children the sandbox, so each path is denied in both. A carve-out (`.env.example`,
 * manifests under `vendor/`) cannot be allowed against a deny: the fragment is stricter there. Same law, same bytes.
 */
export function cageAgentPolicy(givenRoot: string, agent: string | undefined, forbiddenPaths: readonly string[] = []): string {
  const invalid = (what: string, hint?: string): GantryUserError => new GantryUserError("GXT_CAGE_POLICY_INVALID", `cage policy: ${what}`, hint, 2);
  if (agent !== "claude-code") throw invalid(agent ? `unknown agent ${agent}` : "--agent is required", "Supported agents: claude-code.");
  const bad = forbiddenPaths.find((p) => normalizeCageRelPath(p) === null);
  if (bad !== undefined) throw invalid(`contract forbidden path ${JSON.stringify(bad)} is not root-relative`);
  const rules = buildCagePlan(givenRoot).law.rules.filter((r) => r.effect === "deny").flatMap((r) => r.patterns);
  // Git control as a main checkout lays it out; a linked worktree's git dir is outside the project, where the sandbox denies writes.
  const write = [...rules, ...forbiddenPaths.map((p) => normalizeCageRelPath(p)!), ".git/config", ".git/hooks"];
  const home = SECRET_HOME_PATTERNS.map((h) => `~/${h}`);
  const sorted = (xs: string[]): string[] => [...new Set(xs)].sort(byCodePoint);
  const edit = write.map(permissionPath).flatMap(covering).map((p) => `Edit(${p})`);
  const deny = [...edit, ...[...SECRET_ANYWHERE_PATTERNS.map(permissionPath), ...home].flatMap(covering).map((p) => `Read(${p})`)];
  // git reads .git/config on every command: the Read rule keeps it out of the model's context, the sandbox lets git run.
  const read = SECRET_ANYWHERE_PATTERNS.filter((p) => p !== "**/.git/config").map((p) => `./${p}`);
  const filesystem = { denyWrite: sorted(write.map((p) => `./${p}`)), denyRead: sorted([...read, ...home]) };
  const credentials = { files: sorted(home).map((p) => ({ path: p, mode: "deny" })) };
  const fragment = { permissions: { deny: sorted(deny) }, sandbox: { enabled: true, allowUnsandboxedCommands: false, filesystem, credentials } };
  return `${JSON.stringify(fragment, null, 2)}\n`;
}
