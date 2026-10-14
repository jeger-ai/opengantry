import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

/** MSN-0257: scripts/npm-publish-if-new.sh and the npm-publish.yml guard, offline (stub npm on PATH). */

// The mission contract forbids src/cli/lib/ (it must not change what gets published), and ADR-0045 extends a
// forbidden zone to imports, so this file does not import the git helpers. Compiled to dist/cli/tests/, the
// repo root is three levels up.
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Env for a git child in a scratch repo: same rule as gitChildEnv in src/cli/lib/git/git.ts. Inside a git
 * hook (pre-push runs this suite) GIT_DIR / GIT_WORK_TREE would otherwise point git at this repository.
 */
function scratchGitEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0", ...extra };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

const POSIX_ONLY = { skip: process.platform === "win32" ? "bash script" : false };

type ViewMode = "published" | "missing_version" | "missing_package" | "empty" | "error";

interface Fixture {
  dir: string;
  bin: string;
  calls: string;
}

/**
 * A repo-shaped dir with the script under scripts/, a root package and one workspace, plus a stub `npm`
 * that answers `npm view` per STUB_VIEW_MODE and records every invocation, one line per call.
 */
function makeFixture(): Fixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-npm-publish-"));
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.copyFileSync(path.join(REPO_ROOT, "scripts", "npm-publish-if-new.sh"), path.join(dir, "scripts", "npm-publish-if-new.sh"));
  fs.chmodSync(path.join(dir, "scripts", "npm-publish-if-new.sh"), 0o755);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/root", version: "1.2.3", workspaces: ["packages/*"] }));
  fs.mkdirSync(path.join(dir, "packages", "slim"), { recursive: true });
  fs.writeFileSync(path.join(dir, "packages", "slim", "package.json"), JSON.stringify({ name: "@acme/slim", version: "1.2.3" }));
  const bin = path.join(dir, "stub-bin");
  fs.mkdirSync(bin);
  const calls = path.join(dir, "npm-calls.txt");
  fs.writeFileSync(
    path.join(bin, "npm"),
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "$*" >> ${JSON.stringify(calls)}`,
      'if [[ "$1" == "view" ]]; then',
      '  ver="${2##*@}"',
      '  case "$STUB_VIEW_MODE" in',
      '    published) echo "$ver"; exit 0 ;;',
      "    missing_version) echo \"npm error code E404\" >&2; echo \"npm error 404 No match found for version $ver\" >&2; exit 1 ;;",
      "    missing_package) echo \"npm error code E404\" >&2; echo \"npm error 404 Not Found - GET https://registry.npmjs.org/x\" >&2; exit 1 ;;",
      "    empty) exit 0 ;;",
      "    error) echo \"npm error code ETIMEDOUT\" >&2; exit 1 ;;",
      "  esac",
      "fi",
      'if [[ "$1" == "publish" ]]; then',
      '  if [[ "${STUB_PUBLISH_FAIL:-}" == "1" ]]; then echo "npm error code ENEEDAUTH" >&2; exit 1; fi',
      '  echo "+ published"; exit 0',
      "fi",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return { dir, bin, calls };
}

function runScript(
  fx: Fixture,
  mode: ViewMode,
  args: string[] = [],
  extraEnv: NodeJS.ProcessEnv = {},
): { status: number | null; stdout: string; stderr: string; calls: string[] } {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${fx.bin}${path.delimiter}${process.env.PATH ?? ""}`, STUB_VIEW_MODE: mode, ...extraEnv };
  // Tests choose GitHub Actions explicitly; CI must not leak into the default case.
  if (!("GITHUB_ACTIONS" in extraEnv)) delete env.GITHUB_ACTIONS;
  const r = spawnSync("bash", [path.join(fx.dir, "scripts", "npm-publish-if-new.sh"), ...args], { cwd: fx.dir, encoding: "utf8", env });
  const calls = fs.existsSync(fx.calls) ? fs.readFileSync(fx.calls, "utf8").trim().split("\n").filter(Boolean) : [];
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, calls };
}

test("npm-publish-if-new: an already-published version is skipped and npm publish is never called (MSN-0257 DoD 1, DoD 3)", POSIX_ONLY, () => {
  const fx = makeFixture();
  const r = runScript(fx, "published");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /@acme\/root@1\.2\.3 already published, skipping/);
  assert.deepEqual(r.calls, ["view @acme/root@1.2.3 version"]);
});

test("npm-publish-if-new: E404 for a missing version or a missing package publishes with provenance (MSN-0257 DoD 1, DoD 3)", POSIX_ONLY, () => {
  for (const mode of ["missing_version", "missing_package", "empty"] as const) {
    const fx = makeFixture();
    const r = runScript(fx, mode);
    assert.equal(r.status, 0, `${mode}: ${r.stderr}`);
    assert.deepEqual(r.calls, ["view @acme/root@1.2.3 version", "publish --provenance --access public"], mode);
    assert.match(r.stdout, /not on npm; publishing/, mode);
  }
});

test("npm-publish-if-new: --workspace reads that workspace's package.json and passes --workspace (MSN-0257 DoD 1, DoD 3)", POSIX_ONLY, () => {
  const fx = makeFixture();
  fs.writeFileSync(path.join(fx.dir, "packages", "slim", "package.json"), JSON.stringify({ name: "@acme/slim", version: "2.0.0" }));
  const r = runScript(fx, "missing_package", ["--workspace", "@acme/slim"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.calls, ["view @acme/slim@2.0.0 version", "publish --workspace @acme/slim --provenance --access public"]);

  const unknown = runScript(makeFixture(), "missing_package", ["--workspace", "@acme/nope"]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /no workspace named @acme\/nope/);
  assert.deepEqual(unknown.calls, [], "npm is not called for an unknown workspace");
});

test("npm-publish-if-new: any other npm view error fails closed without publishing (MSN-0257 DoD 1, DoD 3)", POSIX_ONLY, () => {
  const fx = makeFixture();
  const r = runScript(fx, "error");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /npm view @acme\/root@1\.2\.3 failed .*not publishing/);
  assert.match(r.stderr, /ETIMEDOUT/);
  assert.deepEqual(r.calls, ["view @acme/root@1.2.3 version"]);
});

test("npm-publish-if-new: --dry-run runs npm publish --dry-run without provenance (MSN-0257 DoD 1)", POSIX_ONLY, () => {
  const fx = makeFixture();
  const r = runScript(fx, "missing_package", ["--dry-run", "--workspace", "@acme/slim"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.calls, ["view @acme/slim@1.2.3 version", "publish --workspace @acme/slim --dry-run --access public"]);
  assert.equal(runScript(makeFixture(), "published", ["--bogus"]).status, 2, "unknown arguments are rejected");
});

test("npm-publish-if-new: a failed publish in GitHub Actions names the missing trusted publisher; elsewhere it just fails (MSN-0259 DoD 2, DoD 4)", POSIX_ONLY, () => {
  const ci = runScript(makeFixture(), "missing_package", ["--workspace", "@acme/slim"], {
    STUB_PUBLISH_FAIL: "1",
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "acme/repo",
    GITHUB_WORKFLOW_REF: "acme/repo/.github/workflows/npm-publish.yml@refs/heads/main",
  });
  assert.equal(ci.status, 1, "the publish failure exit code is kept");
  assert.match(ci.stderr, /::error::npm-publish-if-new: publishing @acme\/slim@1\.2\.3 failed \(exit 1\)/);
  assert.match(ci.stderr, /add one to @acme\/slim with provider GitHub Actions, repository acme\/repo, workflow npm-publish\.yml\./);

  const local = runScript(makeFixture(), "missing_package", [], { STUB_PUBLISH_FAIL: "1" });
  assert.equal(local.status, 1);
  assert.ok(!local.stderr.includes("trusted publisher"), "no CI hint outside GitHub Actions");
});

interface WorkflowStep {
  name?: string;
  if?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}

function loadWorkflow(): { on: Record<string, unknown>; steps: WorkflowStep[] } {
  const doc = YAML.parse(fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "npm-publish.yml"), "utf8")) as {
    on: Record<string, unknown>;
    jobs: { publish: { steps: WorkflowStep[] } };
  };
  return { on: doc.on, steps: doc.jobs.publish.steps };
}

test("npm-publish.yml: tag pushes and a guarded workflow_dispatch; both publishes go through the script (MSN-0257 DoD 2, DoD 3)", () => {
  const { on, steps } = loadWorkflow();
  assert.deepEqual((on.push as { tags: string[] }).tags, ["v*"]);
  const tag = (on.workflow_dispatch as { inputs: { tag: { required: boolean; type: string } } }).inputs.tag;
  assert.equal(tag.required, true);
  assert.equal(tag.type, "string");

  const guardIdx = steps.findIndex((s) => s.name?.startsWith("Guard manual run"));
  const validateIdx = steps.findIndex((s) => s.name === "Validate stack");
  assert.ok(guardIdx >= 0 && validateIdx > guardIdx, "the guard runs before Validate stack");
  const guard = steps[guardIdx]!;
  assert.equal(guard.if, "github.event_name == 'workflow_dispatch'");
  assert.equal(guard.env?.TAG, "${{ inputs.tag }}");
  assert.ok(!guard.run!.includes("${{"), "the tag reaches the shell through env, never interpolated into the script");
  const published = /^\s*published=\((.*)\)\s*$/m.exec(guard.run!)?.[1]?.trim().split(/\s+/);
  assert.deepEqual(published, ["src", "':(exclude)src/cli/tests'", "packages", "package.json", "package-lock.json", "templates", "README.md", "LICENSE", "NOTICE"]);

  const publishes = steps.filter((s) => s.name?.startsWith("Publish "));
  assert.deepEqual(
    publishes.map((s) => s.run),
    ["./scripts/npm-publish-if-new.sh", "./scripts/npm-publish-if-new.sh --workspace @jeger-ai/opengantry-cage"],
  );
  for (const s of publishes) assert.equal(s.env, undefined, `${s.name ?? ""} carries no token env (trusted publishing, MSN-0259)`);
  assert.ok(!steps.some((s) => /(^|\n)\s*npm publish\b/.test(s.run ?? "")), "no bare npm publish step remains");
});

/** Run the guard's shell body from npm-publish.yml in a scratch git repo, as the dispatch would. */
function runGuard(repo: string, tagInput: string): { status: number | null; out: string } {
  const guard = loadWorkflow().steps.find((s) => s.name?.startsWith("Guard manual run"))!;
  const r = spawnSync("bash", ["-c", guard.run!], {
    cwd: repo,
    encoding: "utf8",
    env: scratchGitEnv({ TAG: tagInput, GITHUB_SHA: "HEAD" }),
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

function gitIn(repo: string, ...args: string[]): void {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8", env: scratchGitEnv() });
  assert.equal(r.status, 0, r.stderr);
}

test("npm-publish.yml guard: passes only when the published inputs on HEAD equal the release tag (MSN-0257 DoD 2, DoD 3)", POSIX_ONLY, () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "og-publish-guard-"));
  gitIn(repo, "init", "-q");
  gitIn(repo, "config", "user.email", "guard@test");
  gitIn(repo, "config", "user.name", "guard");
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "@acme/root", version: "1.2.3" }));
  fs.mkdirSync(path.join(repo, "src", "cli", "tests"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "cli", "index.ts"), "export {};\n");
  fs.writeFileSync(path.join(repo, "src", "cli", "tests", "a.test.ts"), "// v1\n");
  fs.writeFileSync(path.join(repo, "README.md"), "v1\n");
  gitIn(repo, "add", "-A");
  gitIn(repo, "commit", "-qm", "release");
  gitIn(repo, "tag", "-a", "v1.2.3", "-m", "release");

  assert.equal(runGuard(repo, "v1.2.3").status, 0, "HEAD is the tag");

  fs.writeFileSync(path.join(repo, "src", "cli", "tests", "a.test.ts"), "// v2\n");
  fs.mkdirSync(path.join(repo, ".github"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".github", "publish.yml"), "x\n");
  gitIn(repo, "add", "-A");
  gitIn(repo, "commit", "-qm", "tests and workflow only");
  const ok = runGuard(repo, "v1.2.3");
  assert.equal(ok.status, 0, ok.out);
  assert.match(ok.out, /publishes the same inputs as v1\.2\.3/);

  const mismatch = runGuard(repo, "v1.2.4");
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.out, /does not match package\.json version v1\.2\.3/);

  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "@acme/root", version: "1.2.4" }));
  gitIn(repo, "commit", "-qam", "bump without a tag");
  const missing = runGuard(repo, "v1.2.4");
  assert.equal(missing.status, 1);
  assert.match(missing.out, /tag 'v1\.2\.4' does not exist/);

  gitIn(repo, "reset", "-q", "--hard", "HEAD~1");
  fs.writeFileSync(path.join(repo, "README.md"), "v2\n");
  gitIn(repo, "commit", "-qam", "published file changed after the tag");
  const drift = runGuard(repo, "v1.2.3");
  assert.equal(drift.status, 1);
  assert.match(drift.out, /published inputs on HEAD differ from v1\.2\.3; refusing to publish/);
  assert.match(drift.out, /README\.md/);
});

test("npm-publish.yml: trusted publishing only, no npm token or secret anywhere (MSN-0259 DoD 1, DoD 4)", () => {
  const text = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "npm-publish.yml"), "utf8");
  assert.ok(!/\bsecrets\./.test(text), "no secrets.* reference remains");
  const doc = YAML.parse(text) as { permissions: Record<string, string>; jobs: { publish: { steps: WorkflowStep[] } } };
  assert.deepEqual(doc.permissions, { contents: "read", "id-token": "write" }, "OIDC needs id-token: write");
  const steps = doc.jobs.publish.steps;
  for (const s of steps) assert.ok(!s.env || !("NODE_AUTH_TOKEN" in s.env), `${s.name ?? s.uses ?? ""} sets no NODE_AUTH_TOKEN`);
  const setupNode = steps.find((s) => s.uses?.startsWith("actions/setup-node@"))!;
  assert.equal(setupNode.with?.["registry-url"], undefined, "no .npmrc token placeholder from setup-node");

  const npmCheck = steps.findIndex((s) => s.name === "Require npm with trusted publishing (>= 11.5.1)");
  const firstPublish = steps.findIndex((s) => s.name?.startsWith("Publish "));
  assert.ok(npmCheck >= 0 && npmCheck < firstPublish, "the npm version check runs before the publishes");
});

test("npm-publish.yml npm version check: passes from npm 11.5.1, fails below (MSN-0259 DoD 1, DoD 4)", POSIX_ONLY, () => {
  const check = loadWorkflow().steps.find((s) => s.name === "Require npm with trusted publishing (>= 11.5.1)")!;
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "og-npm-version-"));
  const cases: [string, number][] = [["10.9.9", 1], ["11.5.0", 1], ["11.5.1", 0], ["11.19.0", 0], ["12.0.0", 0]];
  for (const [version, want] of cases) {
    fs.writeFileSync(path.join(bin, "npm"), `#!/usr/bin/env bash\necho ${version}\n`, { mode: 0o755 });
    const r = spawnSync("bash", ["-c", check.run!], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` },
    });
    assert.equal(r.status, want, `npm ${version}: ${r.stdout}${r.stderr}`);
    if (want === 1) assert.ok(r.stdout.includes(`npm ${version} cannot use trusted publishing; need npm >= 11.5.1`), r.stdout);
  }
});

test("publishConfig: both packages publish public without forcing provenance, so a local emergency publish works (MSN-0259 DoD 3)", () => {
  for (const rel of ["package.json", path.join("packages", "opengantry-cage", "package.json")]) {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")) as { publishConfig: Record<string, unknown> };
    assert.deepEqual(pkg.publishConfig, { access: "public" }, rel);
  }
});
