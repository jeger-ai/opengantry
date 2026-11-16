import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { DependencyInstallReceipt } from "#core/dependency-install.js";
import { dependencyInstallProblem } from "#core/schemas/dependency-install-schema.js";
import { getRepoRoot } from "#git/git.js";
import { executeNpmCi } from "#missions/npm-ci/execute.js";
import { isolatedNpm } from "#missions/npm-ci/npm.js";
import { planNpmCi } from "#missions/npm-ci/plan.js";
import { findNamed, git, lockfile, makeCert, makeRepo, manifest, npmTarball, npmVersion, otherNpmVersion, sri, startRegistry, tarballPath, write, type Cert, type Pkg, type Registry } from "./npm-ci-fixtures.js";

/**
 * Issue #355 slice 4 (MSN-0387): `gantry npm ci`, end to end against a local https registry that records every
 * request. Nothing touches the internet. The canary package's postinstall writes a marker file; it must never appear
 * unless the operator passes the explicit audit flag (the positive control that shows the canary is live).
 */

const CLI = path.join(getRepoRoot(), "dist", "cli", "index.js");

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
  const status = await new Promise<number | null>((resolve) => child.on("close", resolve));
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

test("an admitted graph without scripts installs from verified tarballs, and node_modules is exactly the graph", async () => {
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

test("an installed tree that differs from the admitted graph is refused and never placed in the project", async () => {
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

test("an unapproved addition is refused before any network access", async () => {
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

test("a tarball whose bytes do not match the lockfile integrity is refused before inspection", async () => {
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

test("a redirect to an origin outside the policy registries is refused and never followed", async () => {
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

test("a tarball that adds an install script the lockfile did not declare is refused; the canary never runs", async () => {
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

test("an approved install script refuses capability_unproven under enforce, whatever the candidate's .npmrc and npm_config_* say", async () => {
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

test("the isolated npm configuration ignores a hostile project .npmrc and npm_config_* environment", async () => {
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

test("a wrong npm version is refused before any network access", async () => {
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

test("inputs changed between check and use are refused before materialization", async () => {
  for (const mutate of ["package-lock.json", "package.json"]) {
    reset();
    const pkgs = [A(), T1()];
    serve(...pkgs);
    const { dir, base } = makeRepo(tmp, { registry: reg.url, deps: { a: "1.0.0" }, pkgs });
    const planned = planNpmCi({ root: dir, dir: ".", base, auditUnconfinedScripts: false });
    assert.ok(planned.plan, JSON.stringify(planned.receipt?.reasons));
    fs.appendFileSync(path.join(dir, mutate), "\n");
    const receipt = await executeNpmCi(planned.plan, { ca: cert.cert });
    assert.equal(dependencyInstallProblem(receipt), null);
    assert.equal(receipt.outcome, "refused");
    assert.deepEqual(codes(receipt), ["inputs_changed"], mutate);
    assert.equal(fs.existsSync(path.join(dir, "node_modules")), false);
  }
});

test("a repository without a dependencies policy at the base commit is refused", async () => {
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
