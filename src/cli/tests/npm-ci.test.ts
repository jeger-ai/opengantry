import { createInterface } from "node:readline";
import { buildAdmissionRequest, sendBrokerMessage } from "#missions/admission/client.js";
import { CONTRACT_DIGEST, digestOf, template, writePolicy } from "./admission/fixtures.js";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import type { DependencyInstallReceipt } from "#core/dependency-install.js";
import { dependencyInstallProblem } from "#core/schemas/dependency-install-schema.js";
import { nodeTarProblem } from "#core/dependency-tarball.js";
import { getRepoRoot } from "#git/git.js";
import { executeNpmCi } from "#missions/npm-ci/execute.js";
import { fetchTarball } from "#missions/npm-ci/fetch.js";
import { isolatedNpm, resolveNpm } from "#missions/npm-ci/npm.js";
import { planNpmCi } from "#missions/npm-ci/plan.js";
import { findNamed, git, lockfile, makeCert, makeRepo, manifest, npmTarball, npmVersion, otherNpmVersion, sri, startRegistry, tarballPath, write, type Cert, type Pkg, type Registry } from "./npm-ci-fixtures.js";

/**
 * Issue #355 slice 4 (MSN-0387): `gantry npm ci`, end to end against a local https registry that records every
 * request. Nothing touches the internet. The canary package's postinstall writes a marker file; it must never appear
 * unless the operator passes the explicit audit flag (the positive control that shows the canary is live).
 */

const CLI = path.join(getRepoRoot(), "dist", "cli", "index.js");

/**
 * Time limits (MSN-0393): a run here takes seconds. npm can stall after it has finished (it logs "exit 0", then its
 * process never exits; a Node teardown race, not the fixture registry), and the executor's own limits are ten minutes.
 * So the CLI child is killed after CLI_DEADLINE_MS with its stderr in the failure, every test has a test-level timeout,
 * and in-process runs pass tighter limits through `ExecuteOptions.limits`.
 */
const CLI_DEADLINE_MS = 90_000;
const T = { timeout: 120_000 };
const SHORT_LIMITS = { fetchIdleMs: 10_000, fetchDeadlineMs: 30_000, npmTimeoutMs: 60_000 };

let tmp: string;
let cert: Cert;
let reg: Registry;
let evil: Registry;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gantry-npm-ci-test-"));
  cert = makeCert(tmp);
  reg = await startRegistry(cert);
  evil = await startRegistry(cert);
});

after(async () => {
  await reg.close();
  await evil.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function serve(...pkgs: Pkg[]): void {
  for (const p of pkgs) reg.serve(tarballPath(p), p.tarball);
}

function reset(): void {
  reg.requests.length = 0;
  evil.requests.length = 0;
}

/** Run the CLI without blocking: the fixture registry answers from this process's event loop. */
async function cli(dir: string, args: string[], env: Record<string, string> = {}): Promise<{ status: number | null; receipt: DependencyInstallReceipt; stderr: string }> {
  const child = spawn(process.execPath, [CLI, "npm", "ci", "--json", ...args], {
    cwd: dir,
    env: { PATH: process.env.PATH ?? "", HOME: tmp, NODE_EXTRA_CA_CERTS: cert.certFile, ...env },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
  child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
  let killed = false;
  const deadline = setTimeout(() => {
    killed = true;
    child.kill("SIGKILL");
  }, CLI_DEADLINE_MS);
  const status = await new Promise<number | null>((resolve) => child.on("close", resolve)).finally(() => clearTimeout(deadline));
  if (killed) throw new Error(`gantry npm ci did not finish within ${String(CLI_DEADLINE_MS)} ms and was killed\n${stderr}`);
  let receipt: DependencyInstallReceipt;
  try {
    receipt = JSON.parse(stdout) as DependencyInstallReceipt;
  } catch {
    throw new Error(`no JSON receipt (exit ${String(status)}): ${stdout}\n${stderr}`);
  }
  assert.equal(dependencyInstallProblem(receipt), null, JSON.stringify(receipt, null, 2));
  return { status, receipt, stderr };
}

const codes = (r: DependencyInstallReceipt) => r.reasons.map((x) => x.code);
const installed = (dir: string, rel: string) => JSON.parse(fs.readFileSync(path.join(dir, rel, "package.json"), "utf8")) as { name: string; version: string };

const A = (): Pkg => ({ location: "node_modules/a", name: "a", version: "1.0.0", tarball: npmTarball({ name: "a", version: "1.0.0", bin: { "a-cli": "cli.js" }, dependencies: { t: "1.0.0" } }, { "cli.js": "#!/usr/bin/env node\n" }), extra: { bin: { "a-cli": "cli.js" }, dependencies: { t: "1.0.0" } } });
const T1 = (): Pkg => ({ location: "node_modules/a/node_modules/t", name: "t", version: "1.0.0", tarball: npmTarball({ name: "t", version: "1.0.0" }) });
const T2 = (): Pkg => ({ location: "node_modules/t", name: "t", version: "2.0.0", tarball: npmTarball({ name: "t", version: "2.0.0" }) });

/** A package whose postinstall would write `marker` (absolute) and `canary-marker` in its working directory. */
function canary(marker: string, declared: boolean): Pkg {
  const script = `node -e "require('fs').writeFileSync(${JSON.stringify(marker).replace(/"/g, "'")}, 'ran'); require('fs').writeFileSync('canary-marker', 'ran')"`;
  return { location: "node_modules/canary", name: "canary", version: "1.0.0", tarball: npmTarball({ name: "canary", version: "1.0.0", scripts: { postinstall: script } }), hasInstallScript: declared };
}

test("an admitted graph without scripts installs from verified tarballs, and node_modules is exactly the graph", T, async () => {
  reset();
  const pkgs = [A(), T1(), T2()];
  serve(...pkgs);
  const { dir, base } = makeRepo(tmp, { registry: reg.url, deps: { a: "1.0.0", t: "2.0.0" }, pkgs });
  const r = await cli(dir, ["--base", base]);
  assert.equal(r.status, 0, JSON.stringify(r.receipt.reasons));
  assert.equal(r.receipt.outcome, "installed");
  assert.equal(r.receipt.enforcement, "enforce");
  assert.deepEqual([r.receipt.prevention, r.receipt.preventive_capability, r.receipt.direct_installers_blocked], [false, null, false]);
  assert.deepEqual(r.receipt.npm, { pinned: npmVersion(), found: npmVersion() });
  assert.equal(r.receipt.admission?.outcome, "pass");
  assert.deepEqual(r.receipt.packages.map((p) => [p.location, p.outcome]), [["node_modules/a", "materialized"], ["node_modules/a/node_modules/t", "materialized"], ["node_modules/t", "materialized"]]);
  assert.deepEqual(r.receipt.scripts, []);
  assert.deepEqual([...reg.requests].sort(), pkgs.map(tarballPath).sort());
  assert.deepEqual(installed(dir, "node_modules/a"), { ...installed(dir, "node_modules/a"), name: "a", version: "1.0.0" });
  assert.equal(installed(dir, "node_modules/a/node_modules/t").version, "1.0.0");
  assert.equal(installed(dir, "node_modules/t").version, "2.0.0");
  assert.equal(fs.realpathSync(path.join(dir, "node_modules/.bin/a-cli")), fs.realpathSync(path.join(dir, "node_modules/a/cli.js")));
  assert.deepEqual(fs.readdirSync(path.join(dir, "node_modules")).sort(), [".bin", ".package-lock.json", "a", "t"]);
  assert.match(r.receipt.inputs?.lockfile ?? "", /^[0-9a-f]{64}$/);
  // A second run replaces node_modules (as npm ci does) and is admitted again: node_modules is ignored, not a change.
  assert.equal((await cli(dir, ["--base", base])).status, 0);
});

test("an installed tree that differs from the admitted graph is refused and never placed in the project", T, async () => {
  reset();
  // No edge from a to the nested t: npm prunes it as extraneous, so the tree npm writes lacks an admitted package.
  const a: Pkg = { ...A(), extra: {} };
  serve(a, T1());
  const { dir, base } = makeRepo(tmp, { registry: reg.url, deps: { a: "1.0.0" }, pkgs: [a, T1()] });
  const r = await cli(dir, ["--base", base]);
  assert.equal(r.status, 1);
  assert.deepEqual(codes(r.receipt), ["layout_missing"]);
  assert.equal(r.receipt.reasons[0]?.location, "node_modules/a/node_modules/t");
  assert.equal(fs.existsSync(path.join(dir, "node_modules")), false);
});

test("an unapproved addition is refused before any network access", T, async () => {
  reset();
  const a = A();
  const b: Pkg = { location: "node_modules/b", name: "b", version: "1.0.0", tarball: npmTarball({ name: "b", version: "1.0.0" }) };
  serve(a, T1(), b);
  const { dir, base } = makeRepo(tmp, { registry: reg.url, deps: { a: "1.0.0" }, pkgs: [a, T1()] });
  write(dir, "package.json", manifest({ a: "1.0.0", b: "1.0.0" }));
  write(dir, "package-lock.json", lockfile(reg.url, { a: "1.0.0", b: "1.0.0" }, [a, T1(), b]));
  const r = await cli(dir, ["--base", base]);
  assert.equal(r.status, 1);
  assert.equal(r.receipt.outcome, "refused");
  assert.deepEqual(codes(r.receipt), ["admission_not_pass"]);
  assert.equal(r.receipt.admission?.outcome, "hold");
  assert.ok(r.receipt.admission?.reasons.some((x) => x.code === "unapproved_identity" && x.location === "node_modules/b"));
  assert.equal(r.receipt.npm, null);
  assert.deepEqual(reg.requests, []);
  assert.equal(fs.existsSync(path.join(dir, "node_modules")), false);
});

test("a tarball whose bytes do not match the lockfile integrity is refused before inspection", T, async () => {
  reset();
  const a: Pkg = { ...A(), integrity: sri(Buffer.from("something else")) };
  serve(a, T1());
  const { dir, base } = makeRepo(tmp, { registry: reg.url, deps: { a: "1.0.0" }, pkgs: [a, T1()] });
  const r = await cli(dir, ["--base", base]);
  assert.equal(r.status, 1);
  assert.deepEqual(codes(r.receipt), ["integrity_mismatch"]);
  assert.equal(r.receipt.packages.find((p) => p.location === "node_modules/a")?.outcome, "refused");
  assert.equal(fs.existsSync(path.join(dir, "node_modules")), false);
});

test("a redirect to an origin outside the policy registries is refused and never followed", T, async () => {
  reset();
  const a = A();
  serve(T1());
  evil.serve(tarballPath(a), a.tarball);
  reg.redirect(tarballPath(a), `${evil.url}${tarballPath(a).slice(1)}`);
  const { dir, base } = makeRepo(tmp, { registry: reg.url, deps: { a: "1.0.0" }, pkgs: [a, T1()] });
  const r = await cli(dir, ["--base", base]);
  assert.equal(r.status, 1);
  assert.deepEqual(codes(r.receipt), ["redirect_refused"]);
  assert.deepEqual(evil.requests, []);
  assert.equal(fs.existsSync(path.join(dir, "node_modules")), false);
});

test("a redirect whose path says \"credentials\" is redirect_refused, not url_credentials", T, async () => {
  reset();
  const a = A();
  serve(T1());
  reg.redirect(tarballPath(a), `${evil.url}credentials/a.tgz`);
  const { dir, base } = makeRepo(tmp, { registry: reg.url, deps: { a: "1.0.0" }, pkgs: [a, T1()] });
  const r = await cli(dir, ["--base", base]);
  assert.equal(r.status, 1);
  assert.deepEqual(codes(r.receipt), ["redirect_refused"]);
  assert.deepEqual(evil.requests, []);
});

test("a tarball that adds an install script the lockfile did not declare is refused; the canary never runs", T, async () => {
  reset();
  const marker = path.join(tmp, "marker-undeclared");
  const c = canary(marker, false);
  serve(c);
  const { dir, base } = makeRepo(tmp, { registry: reg.url, deps: { canary: "1.0.0" }, pkgs: [c] });
  const r = await cli(dir, ["--base", base]);
  assert.equal(r.status, 1);
  assert.deepEqual(codes(r.receipt), ["install_script_mismatch"]);
  assert.equal(fs.existsSync(marker), false);
  assert.deepEqual([...findNamed(dir, "canary-marker"), ...findNamed(tmp, "canary-marker")], []);
  assert.equal(fs.existsSync(path.join(dir, "node_modules")), false);
});

test("an approved install script refuses capability_unproven under enforce, whatever the candidate's .npmrc and npm_config_* say", T, async () => {
  reset();
  const marker = path.join(tmp, "marker-approved");
  const c = canary(marker, true);
  serve(c);
  const hostile = `ignore-scripts=false\nregistry=${evil.url}\n`;
  const { dir, base } = makeRepo(tmp, { registry: reg.url, deps: { canary: "1.0.0" }, pkgs: [c], lifecycle: "allow-approved", files: { ".npmrc": hostile } });
  const env = { npm_config_ignore_scripts: "false", npm_config_registry: evil.url, NPM_CONFIG_USERCONFIG: path.join(dir, ".npmrc") };
  const r = await cli(dir, ["--base", base], env);
  assert.equal(r.status, 1);
  assert.deepEqual(codes(r.receipt), ["capability_unproven"]);
  assert.deepEqual(r.receipt.scripts, [{ location: "node_modules/canary", scripts: ["postinstall"], status: "refused" }]);
  assert.equal(r.receipt.enforcement, "enforce");
  assert.equal(fs.existsSync(marker), false);
  assert.deepEqual([...findNamed(dir, "canary-marker"), ...findNamed(tmp, "canary-marker")], []);
  assert.equal(fs.existsSync(path.join(dir, "node_modules")), false);
  assert.deepEqual(evil.requests, []);

  // The positive control: with the explicit audit flag the same canary runs, unconfined, and the receipt says audit.
  reset();
  const audited = await cli(dir, ["--base", base, "--audit-unconfined-scripts"], env);
  assert.equal(audited.status, 0, JSON.stringify(audited.receipt.reasons));
  assert.equal(audited.receipt.outcome, "installed");
  assert.equal(audited.receipt.enforcement, "audit");
  assert.equal(audited.receipt.prevention, false);
  assert.deepEqual(audited.receipt.scripts, [{ location: "node_modules/canary", scripts: ["postinstall"], status: "ran" }]);
  assert.ok(codes(audited.receipt).includes("scripts_ran_unconfined"));
  assert.equal(fs.readFileSync(marker, "utf8"), "ran");
  assert.deepEqual(evil.requests, []);
  assert.deepEqual(reg.requests, [tarballPath(c)]);
});

test("an optional platform package npm leaves out is skipped, and its install script is never recorded as ran", T, async () => {
  reset();
  const marker = path.join(tmp, "marker-root-canary");
  const optMarker = path.join(tmp, "marker-optional");
  const c = canary(marker, true);
  const optScript = `node -e "require('fs').writeFileSync(${JSON.stringify(optMarker).replace(/"/g, "'")}, 'ran')"`;
  const opt: Pkg = {
    location: "node_modules/opt",
    name: "opt",
    version: "1.0.0",
    tarball: npmTarball({ name: "opt", version: "1.0.0", os: ["aix"], scripts: { postinstall: optScript } }),
    hasInstallScript: true,
    extra: { optional: true, os: ["aix"] },
  };
  serve(c, opt);
  const { dir, base } = makeRepo(tmp, { registry: reg.url, deps: { canary: "1.0.0" }, optional: { opt: "1.0.0" }, pkgs: [c, opt], lifecycle: "allow-approved" });
  const r = await cli(dir, ["--base", base, "--audit-unconfined-scripts"]);
  assert.equal(r.status, 0, JSON.stringify(r.receipt.reasons));
  assert.equal(r.receipt.packages.find((p) => p.location === "node_modules/opt")?.outcome, "skipped");
  assert.deepEqual(r.receipt.scripts, [{ location: "node_modules/canary", scripts: ["postinstall"], status: "ran" }]);
  assert.equal(fs.readFileSync(marker, "utf8"), "ran");
  assert.equal(fs.existsSync(optMarker), false);
  assert.equal(fs.existsSync(path.join(dir, "node_modules", "opt")), false);
});

test("the isolated npm configuration ignores a hostile project .npmrc and npm_config_* environment", T, async () => {
  const work = fs.mkdtempSync(path.join(tmp, "isolated-"));
  const marker = path.join(tmp, "marker-isolated");
  const c = canary(marker, true);
  const project = path.join(work, "project");
  write(project, "package.json", manifest({ canary: "1.0.0" }));
  write(project, "package-lock.json", lockfile("https://registry.invalid/", { canary: "1.0.0" }, [c]));
  write(project, ".npmrc", "ignore-scripts=false\nregistry=https://registry.invalid/\n");
  write(work, "canary.tgz", "");
  fs.writeFileSync(path.join(work, "canary.tgz"), c.tarball);
  const saved = { ...process.env };
  process.env.npm_config_ignore_scripts = "false";
  process.env.NODE_OPTIONS = `--require ${path.join(work, "nope.js")}`;
  try {
    const npm = isolatedNpm(fs.mkdtempSync(path.join(tmp, "npmwork-")));
    assert.equal(npm.version(), npmVersion());
    assert.equal(npm.cacheAdd([path.join(work, "canary.tgz")]).status, 0);
    const r = npm.ciOffline(project);
    assert.equal(r.status, 0, r.stderr);
  } finally {
    process.env = saved;
  }
  assert.equal(fs.existsSync(path.join(project, "node_modules/canary/package.json")), true);
  assert.equal(fs.existsSync(marker), false);
  assert.deepEqual(findNamed(project, "canary-marker"), []);
});

test("a wrong npm version is refused before any network access", T, async () => {
  reset();
  const pkgs = [A(), T1()];
  serve(...pkgs);
  const { dir, base } = makeRepo(tmp, { registry: reg.url, deps: { a: "1.0.0" }, pkgs, npmVersion: otherNpmVersion() });
  const r = await cli(dir, ["--base", base]);
  assert.equal(r.status, 1);
  assert.deepEqual(codes(r.receipt), ["npm_version_mismatch"]);
  assert.deepEqual(r.receipt.npm, { pinned: otherNpmVersion(), found: npmVersion() });
  assert.deepEqual(reg.requests, []);
});

test("inputs changed between check and use are refused before materialization", T, async () => {
  for (const mutate of ["package-lock.json", "package.json", "npm-shrinkwrap.json"]) {
    reset();
    const pkgs = [A(), T1()];
    serve(...pkgs);
    const { dir, base } = makeRepo(tmp, { registry: reg.url, deps: { a: "1.0.0" }, pkgs });
    const planned = planNpmCi({ root: dir, dir: ".", base, auditUnconfinedScripts: false });
    assert.ok(planned.plan, JSON.stringify(planned.receipt?.reasons));
    if (mutate === "npm-shrinkwrap.json") fs.copyFileSync(path.join(dir, "package-lock.json"), path.join(dir, mutate));
    else fs.appendFileSync(path.join(dir, mutate), "\n");
    const receipt = await executeNpmCi(planned.plan, { ca: cert.cert, limits: SHORT_LIMITS });
    assert.equal(dependencyInstallProblem(receipt), null);
    assert.equal(receipt.outcome, "refused");
    assert.deepEqual(codes(receipt), ["inputs_changed"], mutate);
    assert.equal(fs.existsSync(path.join(dir, "node_modules")), false);
  }
});

test("a repository without a dependencies policy at the base commit is refused", T, async () => {
  const dir = fs.mkdtempSync(path.join(tmp, "nopolicy-"));
  git(dir, "init", "-q", "-b", "main");
  write(dir, "package.json", manifest({}));
  write(dir, "package-lock.json", lockfile(reg.url, {}, []));
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  const r = await cli(dir, ["--base", "HEAD"]);
  assert.equal(r.status, 1);
  assert.deepEqual(codes(r.receipt), ["policy_missing"]);
});

// --- review round (PR #371) ------------------------------------------------------------------------------------

/** An executable `npm` that leaves `marker` and claims the pinned version, as a planted bin would. */
function plantNpm(dir: string, marker: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "npm"), `#!/bin/sh\necho ran > ${JSON.stringify(marker)}\necho ${npmVersion()}\n`, { mode: 0o755 });
}

test("an npm planted in node_modules/.bin or the repository, first on PATH, never runs", T, async () => {
  reset();
  const pkgs = [A(), T1()];
  serve(...pkgs);
  const { dir, base } = makeRepo(tmp, { registry: reg.url, deps: { a: "1.0.0" }, pkgs, files: { ".gitignore": "node_modules/\ntools/\n" } });
  const marker = path.join(tmp, "marker-planted-npm");
  plantNpm(path.join(dir, "node_modules", ".bin"), marker);
  plantNpm(path.join(dir, "tools"), marker);
  const PATH = [path.join(dir, "node_modules", ".bin"), path.join(dir, "tools"), process.env.PATH ?? ""].join(path.delimiter);
  const r = await cli(dir, ["--base", base], { PATH });
  assert.equal(r.status, 0, JSON.stringify(r.receipt.reasons));
  assert.equal(r.receipt.npm?.found, npmVersion());
  assert.equal(fs.existsSync(marker), false);
});

test("npm resolves beside node first; the PATH fallback skips node_modules/.bin and anything in the repository", T, () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tmp, "resolve-")));
  const repo = path.join(root, "repo");
  const marker = path.join(root, "never");
  plantNpm(path.join(repo, "node_modules", ".bin"), marker);
  plantNpm(path.join(repo, "tools"), marker);
  plantNpm(path.join(root, "elsewhere", "node_modules", ".bin"), marker);
  fs.mkdirSync(path.join(root, "linked"));
  fs.symlinkSync(path.join(repo, "tools", "npm"), path.join(root, "linked", "npm"));
  plantNpm(path.join(root, "trusted"), marker);
  const noNpmBesideNode = path.join(root, "node-without-npm", "bin", "node");
  const bad = [path.join(repo, "node_modules", ".bin"), path.join(repo, "tools"), path.join(root, "elsewhere", "node_modules", ".bin"), path.join(root, "linked"), "relative/bin"];
  assert.equal(resolveNpm({ execPath: noNpmBesideNode, pathEnv: [...bad, path.join(root, "trusted")].join(path.delimiter), repo }), path.join(root, "trusted", "npm"));
  assert.equal(resolveNpm({ execPath: noNpmBesideNode, pathEnv: bad.join(path.delimiter), repo }), null);
  // A repository folder whose name starts with ".." is still inside the repository (CodeRabbit, PR #371).
  plantNpm(path.join(repo, "..tools"), marker);
  assert.equal(resolveNpm({ execPath: noNpmBesideNode, pathEnv: [path.join(repo, "..tools"), path.join(root, "trusted")].join(path.delimiter), repo }), path.join(root, "trusted", "npm"));
  assert.equal(resolveNpm({ execPath: noNpmBesideNode, pathEnv: path.join(repo, "..tools"), repo }), null);
  // The running node's own npm wins over anything on PATH.
  const besideNode = resolveNpm({ pathEnv: path.join(root, "trusted"), repo });
  assert.ok(besideNode?.endsWith(path.join("npm", "bin", "npm-cli.js")), String(besideNode));
  assert.equal(fs.existsSync(marker), false);
});

/** A node prefix with npm beside it: `<prefix>/bin/node`, npm under `lib/node_modules/npm` bundling `tar@tarVersion`. */
function fakeNodePrefix(prefix: string, tarVersion: string): string {
  const npmRoot = path.join(prefix, "lib", "node_modules", "npm");
  write(prefix, "bin/node", "");
  write(npmRoot, "bin/npm-cli.js", "");
  write(npmRoot, "node_modules/pacote/package.json", JSON.stringify({ name: "pacote", version: "1.0.0" }));
  write(npmRoot, "node_modules/tar/package.json", JSON.stringify({ name: "tar", version: tarVersion }));
  return path.join(prefix, "bin", "node");
}

test("an npm run that outlives its time limit is killed and says so, so a stalled npm never holds a run for ten minutes (MSN-0393)", T, () => {
  const work = fs.mkdtempSync(path.join(tmp, "npm-limit-"));
  const r = isolatedNpm(work, undefined, undefined, process.execPath, 1).cacheAdd([path.join(work, "absent.tgz")]);
  assert.equal(r.status, null);
  assert.match(r.stderr, /^npm cache did not exit within 1 ms and was killed$/);
});

test("npm beside node runs with V8 single-threaded, which avoids its stall in teardown after it has finished (MSN-0393)", T, () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tmp, "npm-flags-")));
  fs.mkdirSync(path.join(root, "bin"));
  fs.symlinkSync(process.execPath, path.join(root, "bin", "node"));
  write(root, "lib/node_modules/npm/bin/npm-cli.js", "process.stdout.write(JSON.stringify(process.execArgv));\n");
  const npm = isolatedNpm(path.join(root, "work"), undefined, undefined, path.join(root, "bin", "node"));
  assert.equal(npm.path, path.join(root, "lib/node_modules/npm/bin/npm-cli.js"));
  assert.deepEqual(JSON.parse(npm.version() ?? "null"), ["--single-threaded"]);
});

test("npm's bundled node-tar must be one the tarball reader was checked against", T, () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tmp, "tar-version-")));
  const real = isolatedNpm(path.join(root, "w0"));
  assert.equal(nodeTarProblem(real.tarVersion()), null, `the npm beside node bundles node-tar ${String(real.tarVersion())}`);
  const other = isolatedNpm(path.join(root, "w1"), undefined, undefined, fakeNodePrefix(path.join(root, "prefix"), "7.5.21"));
  assert.equal(other.path, path.join(root, "prefix", "lib", "node_modules", "npm", "bin", "npm-cli.js"));
  assert.equal(other.tarVersion(), "7.5.21");
  assert.match(nodeTarProblem(other.tarVersion())!, /node-tar 7\.5\.21; .*checked against node-tar 7\.5\.22 only/);
});

test("a node inside the repository runs no npm, even through a symlink from outside", T, () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tmp, "node-in-repo-")));
  const repo = path.join(root, "repo");
  const inRepo = fakeNodePrefix(path.join(repo, "tools", "node"), "7.5.22");
  fs.mkdirSync(path.join(root, "outside", "bin"), { recursive: true });
  const linked = path.join(root, "outside", "bin", "node");
  fs.symlinkSync(inRepo, linked);
  // An npm on PATH outside the repository is not used either: npm's PATH would start with the repository folder.
  plantNpm(path.join(root, "trusted"), path.join(root, "never"));
  for (const execPath of [inRepo, linked]) {
    assert.equal(resolveNpm({ execPath, pathEnv: path.join(root, "trusted"), repo }), null, execPath);
    const npm = isolatedNpm(fs.mkdtempSync(path.join(root, "w-")), undefined, repo, execPath);
    assert.equal(npm.nodeInRepository, true, execPath);
    assert.equal(npm.path, null, execPath);
    assert.equal(npm.version(), null, execPath);
  }
  const outsideNode = fakeNodePrefix(path.join(root, "elsewhere"), "7.5.22");
  assert.equal(isolatedNpm(fs.mkdtempSync(path.join(root, "w-")), undefined, repo, outsideNode).nodeInRepository, false);
  assert.equal(fs.existsSync(path.join(root, "never")), false);
});

test("a project without package.json is refused at plan time, before any network access", T, async () => {
  reset();
  const pkgs = [A(), T1()];
  serve(...pkgs);
  const { dir, base } = makeRepo(tmp, { registry: reg.url, deps: { a: "1.0.0" }, pkgs });
  // A parent folder's package.json and .npmrc are what npm would otherwise walk up to.
  write(path.dirname(dir), ".npmrc", `registry=${evil.url}\nignore-scripts=false\n`);
  fs.mkdirSync(path.join(dir, "sub"));
  fs.copyFileSync(path.join(dir, "package-lock.json"), path.join(dir, "sub", "package-lock.json"));
  fs.rmSync(path.join(dir, "package.json"));
  for (const sub of [".", "sub"]) {
    const r = await cli(dir, ["--base", base, "--dir", sub]);
    assert.equal(r.status, 1);
    assert.deepEqual(codes(r.receipt), ["manifest_missing"], sub);
  }
  assert.deepEqual([...reg.requests, ...evil.requests], []);
  fs.rmSync(path.join(path.dirname(dir), ".npmrc"));
});

test("a tarball is streamed to disk under a size cap and an overall deadline, and a failed fetch leaves no file", T, async () => {
  const body = npmTarball({ name: "s", version: "1.0.0" });
  let trickle: NodeJS.Timeout | undefined;
  const server = https.createServer({ key: cert.key, cert: cert.cert }, (req, res) => {
    if (req.url === "/ok.tgz") return void res.end(body);
    res.writeHead(200, { "content-type": "application/octet-stream" });
    // One byte every 50 ms: never idle long enough for the idle timeout, never finished.
    trickle = setInterval(() => res.write("x"), 50);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `https://127.0.0.1:${String((server.address() as AddressInfo).port)}/`;
  const opts = { registries: [base], ca: cert.cert, maxBytes: 1 << 20, timeoutMs: 2_000, deadlineMs: 600, maxRedirects: 0 };
  const work = fs.mkdtempSync(path.join(tmp, "stream-"));
  try {
    const ok = await fetchTarball(`${base}ok.tgz`, path.join(work, "ok.tgz"), opts);
    assert.deepEqual(ok, { ok: true, size: body.length });
    assert.deepEqual(fs.readFileSync(path.join(work, "ok.tgz")), body);
    const big = await fetchTarball(`${base}ok.tgz`, path.join(work, "big.tgz"), { ...opts, maxBytes: 10 });
    assert.equal(big.ok ? "ok" : big.code, "fetch_too_large");
    assert.equal(fs.existsSync(path.join(work, "big.tgz")), false);
    const started = Date.now();
    const slow = await fetchTarball(`${base}slow.tgz`, path.join(work, "slow.tgz"), opts);
    assert.equal(slow.ok, false);
    assert.match(slow.ok ? "" : slow.detail, /deadline/);
    assert.ok(Date.now() - started < 1_900, "the deadline, not the idle timeout, ended the fetch");
    assert.equal(fs.existsSync(path.join(work, "slow.tgz")), false);
  } finally {
    clearInterval(trickle);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("a redirect within the registry origin but outside its base path is refused and never followed", T, async () => {
  reset();
  const a = A();
  const t = T1();
  const scoped = `${reg.url}mirror/`;
  reg.serve(`/mirror${tarballPath(t)}`, t.tarball);
  reg.serve("/other-tenant/a.tgz", a.tarball);
  reg.redirect(`/mirror${tarballPath(a)}`, `${reg.url}other-tenant/a.tgz`);
  const { dir, base } = makeRepo(tmp, { registry: scoped, deps: { a: "1.0.0" }, pkgs: [a, t] });
  const r = await cli(dir, ["--base", base]);
  assert.equal(r.status, 1);
  assert.deepEqual(codes(r.receipt), ["redirect_refused"]);
  assert.equal(reg.requests.includes("/other-tenant/a.tgz"), false);
  assert.equal(fs.existsSync(path.join(dir, "node_modules")), false);
});

test("dependency-only broker publishes the admitted tree and journals refusals and worker errors", { ...T, skip: process.platform !== "linux" }, async (t) => {
  const probe = spawnSync("/usr/bin/bwrap", ["--unshare-all", "--ro-bind", "/usr", "/usr", "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64", "/usr/bin/true"]);
  if (probe.status !== 0) return t.skip("bubblewrap user namespaces unavailable for the dependency worker");
  const admin = fs.mkdtempSync(path.join(os.tmpdir(), "og-dep-"));
  t.after(() => fs.rmSync(admin, { recursive: true, force: true }));
  const { dir, base } = makeRepo(tmp, { registry: reg.url, deps: {}, pkgs: [] });
  const config = path.join(admin, "host.json");
  fs.writeFileSync(config, JSON.stringify({ schema: "opengantry.dependency-host.v1", base }), { mode: 0o600 });
  const bundle = path.join(admin, "dependency.bundle");
  git(dir, "bundle", "create", bundle, "HEAD");
  fs.chmodSync(bundle, 0o600);
  const policy = writePolicy(path.join(admin, "policy.json"), [{ id: "deps", kind: "dependency.materialize", effect: "allow" }]);
  const socket = path.join(admin, "socket", "broker.sock");
  const child = spawn(process.execPath, [CLI, "admission", "serve", "--json", "--harness", "claude-code", "--assume-platform", "ubuntu-26.04-x64",
    "--contract-digest", CONTRACT_DIGEST, "--host-config", config, "--policy", policy, "--socket", socket],
    { cwd: dir, env: { PATH: "/usr/bin:/bin", HOME: admin, GANTRY_STATE_DIR: path.join(admin, "state") } });
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  t.after(async () => { child.kill("SIGTERM"); await closed; });
  const lines = createInterface({ input: child.stdout });
  const output: string[] = [];
  for await (const line of lines) {
    output.push(line);
    if (line === "}" || line.startsWith('{"status"')) break;
  }
  const ready = JSON.parse(output.join("\n"));
  assert.ok(ready.dispatched, JSON.stringify(ready));
  assert.ok(ready.dispatched.includes("dependency.materialize"));
  assert.ok(!ready.dispatched.includes("git.publish"));
  const plan = planNpmCi({ root: dir, dir: ".", base, auditUnconfinedScripts: false }).plan!;
  const resource = { ecosystem: "npm", graphDigest: plan.admission.lockfiles[0]!.head_graph, artifactSetDigest: digestOf(plan.fetches), permittedScriptsDigest: digestOf([]) };
  async function dispatch(identity: typeof resource) {
    const prepared = await sendBrokerMessage(socket, { type: "prepare", kind: "dependency.materialize" }) as Parameters<typeof template>[0];
    const request = buildAdmissionRequest(template(prepared), identity, null);
    const reply = await sendBrokerMessage(socket, { type: "dispatch", request, args: null }, 30_000) as typeof prepared;
    const record = JSON.parse(fs.readFileSync(ready.journal, "utf8").trimEnd().split("\n").at(-1)!);
    assert.equal(record.receipt.provenance.evidenceDigest, digestOf(reply.result), JSON.stringify(reply));
    return reply;
  }
  const refused = await dispatch({ ...resource, graphDigest: "0".repeat(64) });
  assert.equal(refused.result?.reason, "dependency_binding_refused", JSON.stringify(refused));
  assert.equal(fs.existsSync(path.join(dir, "node_modules")), false);
  // The candidate's working policy is not the operator's pinned policy.
  fs.writeFileSync(path.join(dir, "verify.yaml"), "fixture: changed locally\n");
  const accepted = await dispatch(resource);
  assert.equal(accepted.state, "confirmed", JSON.stringify(accepted));
  assert.equal(accepted.result?.verdict, "installed");
  assert.ok(fs.statSync(path.join(dir, "node_modules")).isDirectory());
  fs.writeFileSync(path.join(dir, "package-lock.json"), "{}");
  const inadmissible = await dispatch(resource);
  assert.equal(inadmissible.result?.verdict, "refused");
  assert.match(String(inadmissible.result?.receiptDigest), /^[0-9a-f]{64}$/);
  fs.unlinkSync(bundle);
  const failed = await dispatch(resource);
  assert.equal(failed.result?.reason, "dependency_worker_failed");
  assert.equal(failed.state, "failed");
});
