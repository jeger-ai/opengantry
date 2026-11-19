import { admissionDigest } from "#core/admission.js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseNpmLockfile, type NpmGraph, type NpmGraphNode } from "#core/dependency-graph.js";
import {
  boundedEnvironmentProblem,
  checkIntegrity,
  installReason,
  layoutFindings,
  refuses,
  tarballFindings,
  type BoundedEnvironmentClaim,
  type DependencyInstallReceipt,
  type InstallFetch,
  type InstallPackage,
  type InstallReason,
  type InstallScriptRun,
  type LayoutListing,
} from "#core/dependency-install.js";
import { inspectNpmTarball, nodeTarProblem } from "#core/dependency-tarball.js";
import { FETCH_DEFAULTS, fetchTarball, pool } from "./fetch.js";
import { isolatedNpm, tightenLimit, type IsolatedNpm, type NpmRun } from "./npm.js";
import { changedInputs, installReceipt, planNpmCi, type NpmCiPlan, type NpmCiRequest } from "./plan.js";

/**
 * Enforce the policy's npm pin, inspect the admitted tarballs and recheck inputs before offline installation.
 * Only a verified layout is published. Direct installers are outside this adapter's enforcement boundary.
 */

/** An environment for approved lifecycle scripts; it counts only when its capability cell is proven `prevention`. */
export interface BoundedEnvironment extends BoundedEnvironmentClaim {
  runScripts(projectDir: string, npm: IsolatedNpm): NpmRun;
}

export interface ExecuteOptions {
  /** Extra trusted CA certificates (PEM) for the registry fetch. */
  ca?: string;
  environment?: BoundedEnvironment | null;
  limits?: { fetchIdleMs?: number; fetchDeadlineMs?: number; npmTimeoutMs?: number }; // tighter time limits (tests, MSN-0393): each only lowers its default
}

const FETCH_CONCURRENCY = 8;
const LAYOUT_MAX_ENTRIES = 200_000;

function lastLine(text: string): string {
  return text.trim().split("\n").filter(Boolean).slice(-3).join(" | ");
}

/** List the package folders, `.bin` links and stray entries under `project/node_modules`, following no symlink. */
function readLayout(project: string): LayoutListing {
  const out: LayoutListing = { packages: [], bins: [], other: [] };
  const realProject = fs.realpathSync(project);
  let seen = 0;
  const abs = (rel: string) => path.join(project, ...rel.split("/"));
  const pkg = (rel: string) => {
    const st = fs.lstatSync(abs(rel));
    if (st.isSymbolicLink()) return void out.packages.push({ location: rel, name: null, version: null, symlink: true });
    if (!st.isDirectory()) return void out.other.push(rel);
    let name: string | null = null;
    let version: string | null = null;
    try {
      const m = JSON.parse(fs.readFileSync(path.join(abs(rel), "package.json"), "utf8")) as { name?: unknown; version?: unknown };
      name = typeof m.name === "string" ? m.name : null;
      version = typeof m.version === "string" ? m.version : null;
    } catch {
      // name and version stay null: a mismatch
    }
    out.packages.push({ location: rel, name, version, symlink: false });
    const nested = `${rel}/node_modules`;
    if (fs.existsSync(abs(nested)) && fs.lstatSync(abs(nested)).isDirectory()) visit(nested);
  };
  const bins = (rel: string) => {
    for (const e of fs.readdirSync(abs(rel), { withFileTypes: true })) {
      const link = `${rel}/${e.name}`;
      let target: string | null = null;
      if (e.isSymbolicLink()) {
        try {
          const t = path.relative(realProject, fs.realpathSync(abs(link))).split(path.sep).join("/");
          target = t.startsWith("..") || path.isAbsolute(t) ? null : t;
        } catch {
          target = null;
        }
      }
      out.bins.push({ path: link, target });
    }
  };
  const visit = (nm: string) => {
    for (const e of fs.readdirSync(abs(nm), { withFileTypes: true })) {
      if (++seen > LAYOUT_MAX_ENTRIES) throw new Error(`more than ${String(LAYOUT_MAX_ENTRIES)} entries under node_modules`);
      const rel = `${nm}/${e.name}`;
      if (e.name === ".bin" && e.isDirectory()) bins(rel);
      else if (e.name === ".package-lock.json" && nm === "node_modules" && e.isFile()) continue;
      else if (e.name.startsWith("@") && e.isDirectory()) for (const s of fs.readdirSync(abs(rel))) pkg(`${rel}/${s}`);
      else pkg(rel);
    }
  };
  if (fs.existsSync(abs("node_modules"))) visit("node_modules");
  return out;
}

interface Run {
  plan: NpmCiPlan;
  graph: NpmGraph;
  work: string;
  npm: IsolatedNpm;
  reasons: InstallReason[];
  packages: InstallPackage[];
  scripts: InstallScriptRun[];
  tarballs: string[];
}

/**
 * Fetch one tarball to disk, then verify and inspect it. The read, verification and inspection are synchronous, so
 * across the fetch pool only one tarball is in memory at a time; a refused tarball's file is removed.
 */
async function acquireOne(r: Run, f: InstallFetch, file: string, nodes: Map<string, NpmGraphNode>, opts: ExecuteOptions): Promise<{ entry: InstallPackage; reasons: InstallReason[]; file: string | null }> {
  const entry: InstallPackage = { location: f.location, name: f.name, version: f.version, integrity: f.integrity, outcome: "refused", install_scripts: [] };
  const refused = (...reasons: InstallReason[]) => {
    fs.rmSync(file, { force: true });
    return { entry, reasons, file: null };
  };
  const got = await fetchTarball(f.resolved, file, { ...FETCH_DEFAULTS, timeoutMs: tightenLimit(FETCH_DEFAULTS.timeoutMs, opts.limits?.fetchIdleMs), deadlineMs: tightenLimit(FETCH_DEFAULTS.deadlineMs, opts.limits?.fetchDeadlineMs), registries: r.plan.policy.registries, ...(opts.ca ? { ca: opts.ca } : {}) });
  if (!got.ok) return refused(installReason(got.code, got.code === "url_credentials" ? "fail" : "hold", f.location, `${f.resolved}: ${got.detail}`));
  const bytes = fs.readFileSync(file);
  const integrity = checkIntegrity(f.integrity, bytes);
  if (integrity.status !== "match") return refused(installReason(`integrity_${integrity.status}`, "hold", f.location, integrity.detail));
  const inspected = inspectNpmTarball(bytes);
  if (!inspected.ok) return refused(installReason("tarball_malformed", "hold", f.location, inspected.detail));
  const found = tarballFindings(f, nodes.get(f.location)!, inspected.contents);
  entry.install_scripts = found.installScripts;
  if (found.reasons.length > 0) return refused(...found.reasons);
  entry.outcome = "verified";
  return { entry, reasons: [], file };
}

/** Steps 2 and 3: fetch, verify and inspect every tarball, and decide the lifecycle scripts. */
async function acquire(r: Run, opts: ExecuteOptions): Promise<void> {
  const nodes = new Map<string, NpmGraphNode>(r.graph.nodes.map((n) => [n.location, n]));
  const dir = path.join(r.work, "tarballs");
  fs.mkdirSync(dir);
  const indexed = r.plan.fetches.map((f, i) => ({ f, file: path.join(dir, `${String(i)}.tgz`) }));
  const results = await pool(indexed, FETCH_CONCURRENCY, ({ f, file }) => acquireOne(r, f, file, nodes, opts));
  for (const { entry, reasons, file } of results) {
    r.packages.push(entry);
    r.reasons.push(...reasons);
    if (file !== null) r.tarballs.push(file);
  }
  if (refuses(r.reasons)) return;
  const scripted = r.packages.filter((p) => p.install_scripts.length > 0);
  if (scripted.length === 0 || r.plan.request.auditUnconfinedScripts) return;
  const problem = boundedEnvironmentProblem(opts.environment ?? null);
  if (problem === null) return;
  for (const p of scripted) {
    r.scripts.push({ location: p.location, scripts: p.install_scripts, status: "refused" });
    r.reasons.push(installReason("capability_unproven", "hold", p.location, `approved ${p.install_scripts.join(", ")} not run: ${problem}; --audit-unconfined-scripts runs it unconfined and labels the receipt audit`));
  }
}

/** Step 5: materialize from the verified cache in a staging directory, then run approved scripts if allowed. */
function materialize(r: Run, opts: ExecuteOptions, staging: string): void {
  const added = r.npm.cacheAdd(r.tarballs);
  if (added.status !== 0) return void r.reasons.push(installReason("npm_failed", "hold", null, `npm cache add: ${lastLine(added.stderr)}`));
  fs.mkdirSync(staging);
  fs.writeFileSync(path.join(staging, path.basename(r.plan.lockfile)), r.plan.lockText);
  if (r.plan.manifestText !== null) fs.writeFileSync(path.join(staging, "package.json"), r.plan.manifestText);
  const ci = r.npm.ciOffline(staging);
  if (ci.status !== 0) return void r.reasons.push(installReason("npm_failed", "hold", null, `npm ci --offline --ignore-scripts: ${lastLine(ci.stderr)}`));
  if (!checkLayout(r, staging)) return;
  // Only packages npm placed: an optional platform package it left out (skipped) ran nothing.
  const scripted = r.packages.filter((p) => p.outcome === "materialized" && p.install_scripts.length > 0);
  if (scripted.length === 0) return;
  const env = opts.environment ?? null;
  const confined = !r.plan.request.auditUnconfinedScripts && env !== null && boundedEnvironmentProblem(env) === null;
  const ran = confined ? env.runScripts(staging, r.npm) : r.npm.rebuildUnconfined(staging);
  const status = ran.status === 0 ? "ran" : "failed";
  for (const p of scripted) r.scripts.push({ location: p.location, scripts: p.install_scripts, status });
  if (!confined) r.reasons.push(installReason("scripts_ran_unconfined", "info", null, "--audit-unconfined-scripts: approved install scripts ran without confinement; this result is audit-only"));
  if (ran.status !== 0) return void r.reasons.push(installReason("scripts_failed", "hold", null, lastLine(ran.stderr)));
  checkLayout(r, staging);
}

function checkLayout(r: Run, project: string): boolean {
  let listing: LayoutListing;
  try {
    listing = readLayout(project);
  } catch (e) {
    r.reasons.push(installReason("layout_unexpected", "hold", null, (e as Error).message));
    return false;
  }
  const { reasons, skipped } = layoutFindings(r.graph, listing);
  r.reasons.push(...reasons);
  for (const p of r.packages) if (p.outcome === "verified" || p.outcome === "materialized" || p.outcome === "skipped") p.outcome = skipped.includes(p.location) ? "skipped" : "materialized";
  return reasons.length === 0;
}

/** Step 6: replace the project's `node_modules` with the staged one, as `npm ci` replaces it. */
function place(r: Run, staging: string): void {
  const project = path.join(r.plan.top, ...r.plan.directory.split("/").filter((s) => s !== "."));
  const target = path.join(project, "node_modules");
  fs.rmSync(target, { recursive: true, force: true });
  if (!fs.existsSync(path.join(staging, "node_modules"))) fs.mkdirSync(path.join(staging, "node_modules"));
  try {
    fs.renameSync(path.join(staging, "node_modules"), target);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    fs.cpSync(path.join(staging, "node_modules"), target, { recursive: true, verbatimSymlinks: true });
  }
  if (!checkLayout(r, project)) fs.rmSync(target, { recursive: true, force: true });
}

/** Execute a plan. Every refusal before step 6 leaves the project's `node_modules` untouched. */
export async function executeNpmCi(plan: NpmCiPlan, opts: ExecuteOptions = {}): Promise<DependencyInstallReceipt> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "gantry-npm-ci-"));
  const graph = parseNpmLockfile(plan.lockText, { ...(plan.manifestText === null ? {} : { manifest: plan.manifestText }), limits: plan.policy.limits });
  const npm = isolatedNpm(path.join(work, "npm"), plan.policy.registries[0], plan.top, process.execPath, opts.limits?.npmTimeoutMs);
  const r: Run = { plan, graph: graph.status === "ok" ? graph.graph : (null as never), work, npm, reasons: [], packages: [], scripts: [], tarballs: [] };
  const pinned = plan.policy.npm.npmVersion;
  let found: string | null = null;
  try {
    if (graph.status !== "ok") r.reasons.push(installReason("admission_not_pass", "hold", plan.lockfile, graph.detail));
    else {
      found = npm.version();
      const tarProblem = npm.path === null ? null : nodeTarProblem(npm.tarVersion());
      if (npm.nodeInRepository) r.reasons.push(installReason("npm_not_found", "hold", null, `the running node (${process.execPath}) is inside the repository; no npm is run with it`));
      else if (npm.path === null) r.reasons.push(installReason("npm_not_found", "hold", null, "no npm beside the running node or on PATH outside the repository and node_modules/.bin"));
      else if (found !== pinned) r.reasons.push(installReason("npm_version_mismatch", "hold", npm.path, `the policy pins npm ${pinned}; ${npm.path} is ${found ?? "unreadable"}. No other version is used.`));
      else if (tarProblem !== null) r.reasons.push(installReason("npm_tar_unverified", "hold", npm.path, tarProblem));
    }
    if (!refuses(r.reasons)) await acquire(r, opts);
    if (!refuses(r.reasons)) {
      const changed = changedInputs(plan);
      if (changed.length > 0) r.reasons.push(installReason("inputs_changed", "hold", plan.lockfile, `changed since admission: ${changed.join(", ")}; nothing was materialized`));
    }
    const staging = path.join(work, "project");
    if (!refuses(r.reasons)) materialize(r, opts, staging);
    if (!refuses(r.reasons)) place(r, staging);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  const unconfined = r.scripts.some((s) => s.status !== "refused") && r.reasons.some((x) => x.code === "scripts_ran_unconfined");
  return installReceipt({
    enforcement: plan.policy.mode === "audit" || unconfined ? "audit" : "enforce",
    base: plan.base,
    head: plan.head,
    directory: plan.directory,
    lockfile: plan.lockfile,
    inputs: plan.inputs,
    npm: { pinned, found },
    admission: plan.admission,
    packages: r.packages,
    scripts: r.scripts,
    reasons: r.reasons,
  });
}

/** Plan, then execute when the plan admits. */
export async function runNpmCi(req: NpmCiRequest, opts: ExecuteOptions = {}): Promise<DependencyInstallReceipt> {
  const planned = planNpmCi(req);
  return planned.plan ? executeNpmCi(planned.plan, opts) : planned.receipt;
}

/** Credential-free broker worker. The operator selects the immutable base. The caller supplies only the three resource digests. */
async function brokerInstall(base: string, resource: unknown) {
  execFileSync("/usr/bin/git", ["clone", "--quiet", "--no-checkout", "--", "/policy.bundle", "project"]);
  process.chdir("project");
  execFileSync("/usr/bin/git", ["checkout", "--quiet", "--detach", base]);
  for (const name of ["package-lock.json", "npm-shrinkwrap.json", "package.json"]) {
    fs.rmSync(name, { force: true });
    if (fs.existsSync(path.join("/work", name))) fs.copyFileSync(path.join("/work", name), name, fs.constants.COPYFILE_EXCL);
  }
  const planned = planNpmCi({ root: process.cwd(), dir: ".", base, auditUnconfinedScripts: false });
  let receipt = planned.receipt;
  const plan = planned.plan;
  if (plan) {
    const graphDigest = plan.admission.lockfiles.find((l) => l.path === plan.lockfile)?.head_graph;
    const expected = { ecosystem: "npm", graphDigest, artifactSetDigest: admissionDigest(plan.fetches), permittedScriptsDigest: admissionDigest([]) };
    if (plan.policy.mode !== "enforce" || plan.fetches.some((f) => f.installScript) || admissionDigest(resource) !== admissionDigest(expected)) {
      return { verdict: "refused", reason: "dependency_binding_refused", receiptDigest: null };
    }
    receipt = await executeNpmCi(plan);
  }
  if (!receipt) throw new Error("missing dependency install receipt");
  return { verdict: receipt.outcome, reason: receipt.reasons[0]?.code ?? receipt.outcome, receiptDigest: admissionDigest(receipt) };
}

if (import.meta.main) {
  const [base, identity] = process.argv.slice(2);
  if (!base || !identity) throw new Error("missing broker input");
  process.stdout.write(JSON.stringify(await brokerInstall(base, JSON.parse(identity))));
}
