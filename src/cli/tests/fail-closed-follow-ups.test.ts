import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import type { Manifest } from "#core/manifest.js";
import { getRepoRoot, gitChildEnv, setGitSpawnForTests } from "#git/git.js";
import { checkMsnRange } from "#missions/ci-checks.js";
import { scanContractImports } from "#missions/contract/contract-scan.js";
import { resolveEffectiveScope } from "#missions/contract/effective-scope.js";
import { loadManifest } from "#missions/manifest.js";
import { tightenLimit } from "#missions/npm-ci/npm.js";
import { evaluateTrustedAutomationCommit, evaluateTrustedAutomationRange } from "#missions/trusted-automation.js";
import { contentDigestAt } from "#verify/dependencies.js";
import { runVerifyContract } from "#verify/run.js";
import { writeManifest } from "./test-fixtures.js";

/**
 * MSN-0393 (issues #355/#356): follow-ups the PR #371/#373 reviews found. A git read that fails is an error, never
 * "nothing changed", "no files" or "no approvals"; a root commit is judged as one, not as a commit that touches nothing.
 */

const CLI = path.join(getRepoRoot(), "dist", "cli", "index.js");

/** Real git, except for the calls `match` selects: those report exit 128 with no stdout. */
function failGit(match: (args: string[]) => boolean): void {
  setGitSpawnForTests((command: string, args: string[], options: SpawnSyncOptions) => {
    const r = spawnSync(command, args, options);
    if (!match(args)) return r;
    const like = (o: string | Buffer | null | undefined, s: string) => (typeof o === "string" ? s : Buffer.from(s));
    return { ...r, stdout: like(r.stdout, ""), stderr: like(r.stderr, "fatal: injected failure (MSN-0393 test)\n"), status: 128, signal: null };
  });
}
/** Real git, except that the calls `match` selects run with a tiny maxBuffer, so Node truly cuts their stdout (ENOBUFS). */
function cutGit(match: (args: string[]) => boolean, maxBuffer = 16): void {
  setGitSpawnForTests((command: string, args: string[], options: SpawnSyncOptions) => spawnSync(command, args, match(args) ? { ...options, maxBuffer } : options));
}
test.afterEach(() => setGitSpawnForTests(null));

/** git args after `-C <root>`. */
const gitArgs = (args: string[]) => (args[0] === "-C" ? args.slice(2) : args);
const has = (...parts: string[]) => (args: string[]) => parts.every((p) => args.includes(p));

const temps: string[] = [];
test.after(() => {
  for (const t of temps) fs.rmSync(t, { recursive: true, force: true });
});
function tmp(prefix: string): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  temps.push(d);
  return d;
}

function git(dest: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", dest, "-c", "user.email=fixture@example.com", "-c", "user.name=Fixture", "-c", "commit.gpgsign=false", ...args], {
    encoding: "utf8",
    env: gitChildEnv(),
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function put(dest: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
    fs.writeFileSync(path.join(dest, rel), text);
  }
}

function commit(dest: string, files: Record<string, string>, message: string, author = "fixture@example.com"): string {
  put(dest, files);
  git(dest, "add", "-A");
  git(dest, "-c", `user.email=${author}`, "commit", "-q", "--allow-empty", "-m", message);
  return git(dest, "rev-parse", "HEAD");
}

function initRepo(prefix: string): string {
  const dest = tmp(prefix);
  git(dest, "init", "-q", "-b", "main");
  return dest;
}

const isGitError = (err: unknown) => /git .*failed|injected failure/.test((err as Error).message);
const withCode = (code: string) => (err: unknown) => (err as { code?: string }).code === code && isGitError(err);

// --- 1. gantry deps check --since ---------------------------------------------------------------------------------

function depsCheck(dest: string, since: string): { status: number | null; json: { status?: string; results?: unknown[]; message?: string } } {
  const r = spawnSync(process.execPath, [CLI, "deps", "check", "--since", since, "--json"], { cwd: dest, encoding: "utf8", env: { ...gitChildEnv(), NO_COLOR: "1" } });
  return { status: r.status, json: JSON.parse(r.stdout || "{}") as { status?: string; results?: unknown[]; message?: string } };
}

test("deps check --since: a ref git cannot diff is an error, not '0 dependency check(s)' with status ok (MSN-0393)", () => {
  const dest = initRepo("og-fc-deps-");
  writeManifest(dest, { app: { trust_threshold: "Tier-2", tmvc_roots: ["src/"], forbidden_zones: [] } });
  commit(dest, { "README.md": "r\n" }, "base");
  git(dest, "tag", "v1.0.0", commit(dest, { "README.md": "release\n" }, "release"));
  commit(dest, { "README.md": "next\n" }, "next");

  const ok = depsCheck(dest, "v1.0.0");
  assert.equal(ok.status, 0, JSON.stringify(ok.json));
  assert.equal(ok.json.status, "ok");

  const missing = depsCheck(dest, "no-such-tag-xyz");
  assert.equal(missing.json.status, "failed", JSON.stringify(missing.json));
  assert.notEqual(missing.status, 0);
  assert.match(missing.json.message ?? "", /git diff .*failed/);
});

test("deps check --since: a tag on the root commit diffs from the empty tree instead of failing on <tag>^ (MSN-0393 review)", () => {
  const dest = initRepo("og-fc-deps-root-");
  writeManifest(dest, { app: { trust_threshold: "Tier-2", tmvc_roots: ["src/"], forbidden_zones: [] } });
  git(dest, "tag", "v0", commit(dest, { "README.md": "r\n" }, "root"));
  commit(dest, { "README.md": "next\n" }, "next");
  const r = depsCheck(dest, "v0");
  assert.equal(r.json.status, "ok", JSON.stringify(r.json));
  assert.equal(r.status, 0);
});

test("deps check --since: a shallow clone's boundary commit asks for more history, not a raw git error (MSN-0393 review)", () => {
  const origin = initRepo("og-fc-deps-shallow-src-");
  writeManifest(origin, { app: { trust_threshold: "Tier-2", tmvc_roots: ["src/"], forbidden_zones: [] } });
  commit(origin, { "README.md": "r\n" }, "root");
  commit(origin, { "README.md": "next\n" }, "next");
  const dest = tmp("og-fc-deps-shallow-");
  git(dest, "clone", "-q", "--depth", "1", `file://${origin}`, ".");
  const r = depsCheck(dest, "HEAD");
  assert.equal(r.json.status, "failed", JSON.stringify(r.json));
  assert.notEqual(r.status, 0);
  assert.match(r.json.message ?? "", /shallow.*fetch more history/);
});

// --- 2. trusted automation on a root commit -----------------------------------------------------------------------

const BOT = "dependabot[bot]@users.noreply.github.com";
const WORKFLOW_RULES = {
  trusted_automation: {
    rules: [{ id: "workflow-bumps", allowed_actors: [BOT], allowed_paths: [".github/workflows/**"], allowed_structural_changes: ["workflow_version_pin"], max_net_loc: 5 }],
  },
};

function rootCommitRepo(prefix: string): { dest: string; sha: string } {
  const dest = initRepo(prefix);
  writeManifest(dest, { app: { trust_threshold: "Tier-2", tmvc_roots: ["src/"], forbidden_zones: [] } });
  const sha = commit(dest, { ".gitagent/config.json": JSON.stringify(WORKFLOW_RULES), ".github/workflows/ci.yml": "on: push\n" }, "ci: root", BOT);
  return { dest, sha };
}

test("trusted automation: a root commit is not eligible because every file is added, not because it touches nothing (MSN-0393)", () => {
  const { dest, sha } = rootCommitRepo("og-fc-root-");
  const v = evaluateTrustedAutomationCommit(dest, loadManifest(dest), sha);
  assert.equal(v.eligible, false);
  assert.match(v.reason, /root commit/);
  assert.match(v.reason, /added/);
});

test("trusted automation: a failed parent read is an error, not a root commit (MSN-0393)", () => {
  const { dest, sha } = rootCommitRepo("og-fc-root-fail-");
  failGit((args) => has("rev-list", "--parents")(gitArgs(args)));
  assert.throws(() => evaluateTrustedAutomationCommit(dest, loadManifest(dest), sha), isGitError);
});

test("trusted automation: a shallow clone's boundary commit says so, not 'root commit' (MSN-0393 review)", () => {
  const { dest: origin } = rootCommitRepo("og-fc-ta-shallow-src-");
  commit(origin, { ".github/workflows/ci.yml": "on: [push]\n" }, "ci: bump", BOT);
  const dest = tmp("og-fc-ta-shallow-");
  git(dest, "clone", "-q", "--depth", "1", `file://${origin}`, ".");
  const v = evaluateTrustedAutomationCommit(dest, loadManifest(dest), git(dest, "rev-parse", "HEAD"));
  assert.equal(v.eligible, false);
  assert.match(v.reason, /shallow boundary: fetch more history/);
  assert.doesNotMatch(v.reason, /root commit/);
});

// --- 5. root commits inside a range (an unrelated history merged with --allow-unrelated-histories) ---------------

/** main has a base commit; an orphan branch's root commit adds `files` as `author` with `subject`; main merges it. */
function unrelatedMerge(prefix: string, files: Record<string, string>, subject: string, author: string, config: object = {}): { dest: string; base: string; head: string } {
  const dest = initRepo(prefix);
  writeManifest(dest, { app: { trust_threshold: "Tier-2", tmvc_roots: ["src/"], forbidden_zones: [] } });
  const base = commit(dest, { ".gitagent/config.json": JSON.stringify(config), "src/a.ts": "export const a = 1;\n" }, "[MSN-0001] base");
  git(dest, "checkout", "-q", "--orphan", "side");
  git(dest, "rm", "-rq", "--cached", ".");
  for (const e of fs.readdirSync(dest)) if (e !== ".git") fs.rmSync(path.join(dest, e), { recursive: true, force: true });
  commit(dest, files, subject, author);
  git(dest, "checkout", "-q", "main");
  git(dest, "merge", "-q", "--allow-unrelated-histories", "--no-edit", "-m", "[MSN-0001] merge side", "side");
  return { dest, base, head: git(dest, "rev-parse", "HEAD") };
}

test("ci msn-range: a root commit merged from an unrelated history is checked, not skipped as touching nothing (MSN-0393 review)", () => {
  const { dest, base, head } = unrelatedMerge("og-fc-msn-root-", { "src/evil.ts": "export const evil = 1;\n" }, "sneak in", "fixture@example.com");
  const r = checkMsnRange(dest, loadManifest(dest), base, head);
  assert.equal(r.ok, false, r.lines.join("\n"));
  assert.match(r.failures.join("\n"), /subject does not start with \[MSN-NNNN\]/);
  assert.match(r.failures.join("\n"), /src\/evil\.ts/);
});

test("trusted automation range: a merged root commit's actor is checked (MSN-0393 review)", () => {
  const { dest, base, head } = unrelatedMerge("og-fc-ta-range-root-", { "src/evil.ts": "export const evil = 1;\n" }, "ci: add", "intruder@example.com", WORKFLOW_RULES);
  const root = git(dest, "rev-parse", "side");
  const v = evaluateTrustedAutomationRange(dest, loadManifest(dest), base, head);
  assert.equal(v.eligible, false);
  // The per-commit actor check names the commit; skipped, the root commit would only reach the range-wide verdict.
  assert.equal(v.reason, `commit ${root.slice(0, 7)}: actor intruder@example.com not covered by trusted_automation policy`);
});

// --- 3. contract import scan with empty tmvc_roots -----------------------------------------------------------------

/** A substrate-like skill (no roots) and a contract that bans an import but lists no roots: the scan reads git. */
function rootlessScope() {
  const manifest = { schema_version: "0.5.0", skills: { substrate: { desc: "", trust_threshold: "Tier-3", tmvc_roots: [], forbidden_zones: [], gate_commands: [] } } } as unknown as Manifest;
  return resolveEffectiveScope({ manifest, skillKey: "substrate", contract: { banned_imports: ["left-pad"] }, policy: null });
}

test("contract scan: with no tmvc_roots, a failed git listing is an error, not an empty scan (MSN-0393)", () => {
  const dest = initRepo("og-fc-scan-");
  commit(dest, { "src/a.ts": "export const a = 1;\n" }, "base");
  put(dest, { "src/a.ts": 'import pad from "left-pad";\nexport const a = pad;\n', "src/new.ts": 'import "left-pad";\n' });
  const scope = rootlessScope();
  assert.deepEqual(scope.tmvcRoots, []);
  assert.deepEqual(scanContractImports(dest, scope).map((v) => v.file), ["src/a.ts", "src/new.ts"]);

  failGit((args) => ["diff", "ls-files"].includes(gitArgs(args)[0] ?? ""));
  assert.throws(() => scanContractImports(dest, scope), isGitError);
  setGitSpawnForTests(null);
  failGit((args) => has("ls-files", "--others")(gitArgs(args)));
  assert.throws(() => scanContractImports(dest, scope), isGitError);
});

test("contract scan: rev-parse failing with an exit code other than 1 is an error, not an unborn branch (MSN-0393 review)", () => {
  const dest = initRepo("og-fc-scan-revparse-");
  commit(dest, { "src/a.ts": "export const a = 1;\n" }, "base");
  put(dest, { "src/new.ts": 'import "left-pad";\n' });
  failGit((args) => has("rev-parse", "--verify")(gitArgs(args)));
  assert.throws(() => scanContractImports(dest, rootlessScope()), /rev-parse --verify HEAD failed/);
});

test("contract scan: on an unborn branch the index still stands in for the diff (MSN-0393)", () => {
  const dest = initRepo("og-fc-scan-unborn-");
  put(dest, { "src/a.ts": 'import "left-pad";\n' });
  git(dest, "add", "src/a.ts");
  put(dest, { "src/b.ts": 'import "left-pad";\n' });
  assert.deepEqual(scanContractImports(dest, rootlessScope()).map((v) => v.file), ["src/a.ts", "src/b.ts"]);
});

// --- 4. verify dependencies: listings ------------------------------------------------------------------------------

const REG = "https://registry.npmjs.org/";
const reg = (name: string, version: string) => ({ version, resolved: `${REG}${name}/-/${name}-${version}.tgz`, integrity: `sha512-${name}-${version}` });
const lock = (deps: Record<string, string>, pkgs: Record<string, unknown>) =>
  `${JSON.stringify({ name: "app", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "app", version: "1.0.0", dependencies: deps }, ...pkgs } }, null, 2)}\n`;
const pkgJson = (deps: Record<string, string>) => `${JSON.stringify({ name: "app", version: "1.0.0", dependencies: deps }, null, 2)}\n`;
const POLICY = [
  "schema: opengantry.verify.v1",
  "dependencies:",
  "  schema: opengantry.dependency-policy.v1",
  "  mode: enforce",
  "  ecosystems:",
  "    npm:",
  "      lockfile_versions: [2, 3]",
  '      npm_version: "11.6.2"',
  "  registries:",
  `    - ${REG}`,
  "  lifecycle:",
  "    default: deny",
  "",
].join("\n");

/** A base with `a`, and a change that adds `b` without an approval: an honest run holds on `unapproved_identity`. */
function unapprovedAddition(prefix: string): { dest: string; base: string } {
  const dest = initRepo(prefix);
  const base = commit(dest, { "verify.yaml": POLICY, "package.json": pkgJson({ a: "^1.0.0" }), "package-lock.json": lock({ a: "^1.0.0" }, { "node_modules/a": reg("a", "1.0.0") }) }, "base");
  const deps = { a: "^1.0.0", b: "^1.0.0" };
  commit(dest, { "package.json": pkgJson(deps), "package-lock.json": lock(deps, { "node_modules/a": reg("a", "1.0.0"), "node_modules/b": reg("b", "1.0.0") }) }, "add b");
  return { dest, base };
}

test("verify dependencies: a failed approvals listing is GXT_VERIFY_GIT_FAILED, not 'unapproved' (MSN-0393)", () => {
  const { dest, base } = unapprovedAddition("og-fc-approvals-");
  const run = () => runVerifyContract({ cwd: dest, base, now: "2026-11-17T12:00:00Z" });
  const honest = run();
  assert.notEqual(honest.status, "pass");
  assert.ok(honest.dependencies!.reasons.some((r) => r.code === "unapproved_identity"), JSON.stringify(honest.dependencies!.reasons));

  failGit((args) => has("ls-tree", "--name-only", ".gitagent/dependency-approvals/")(gitArgs(args)));
  assert.throws(run, withCode("GXT_VERIFY_GIT_FAILED"));
});

test("verify dependencies: the tree listings go through the git adapter, so a truncated listing is GXT_VERIFY_GIT_FAILED (MSN-0393)", () => {
  const { dest, base } = unapprovedAddition("og-fc-treelist-");
  const run = () => runVerifyContract({ cwd: dest, base, now: "2026-11-17T12:00:00Z" });
  assert.notEqual(run().status, "pass");

  // Only the dependency judge's own full listing of the base tree: `ls-tree -r -z --full-tree <base>`, no pathspec.
  // Node cuts its stdout at 16 bytes (ENOBUFS), as a listing larger than listMaxBytes would be.
  cutGit((args) => {
    const a = gitArgs(args);
    return a.length === 5 && a[0] === "ls-tree" && a[3] === "--full-tree" && a[4] === base;
  });
  assert.throws(run, (err: unknown) => withCode("GXT_VERIFY_GIT_FAILED")(err) && /ENOBUFS/.test((err as Error).message));
});

test("verify dependencies: a cut content read goes through gitRunBytes and gives no digest an approval could match (MSN-0393 review)", () => {
  const dest = initRepo("og-fc-digest-");
  const sha = commit(dest, { "vendor/x/package.json": `${JSON.stringify({ name: "x", version: "1.0.0", description: "y".repeat(256) })}\n`, "vendor/x/index.js": "module.exports = 1;\n" }, "vendor");
  assert.match(contentDigestAt(dest, sha, "vendor/x") ?? "", /^[0-9a-f]{64}$/);
  cutGit((args) => has("cat-file", "--batch")(gitArgs(args)));
  assert.equal(contentDigestAt(dest, sha, "vendor/x"), null);
});

// --- 6. npm ci time limits only tighten ---------------------------------------------------------------------------

test("npm ci limits: 0, NaN, negative, fractional and above-default values keep the default; a smaller positive integer tightens (MSN-0393 review)", () => {
  for (const bad of [0, Number.NaN, -1, -60_000, 1.5, Infinity, 120_000]) assert.equal(tightenLimit(60_000, bad), 60_000, String(bad));
  assert.equal(tightenLimit(60_000, undefined), 60_000);
  assert.equal(tightenLimit(60_000, 1), 1);
  assert.equal(tightenLimit(60_000, 500), 500);
  assert.equal(tightenLimit(60_000, 60_000), 60_000);
});
