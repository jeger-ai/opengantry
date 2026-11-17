import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson } from "#core/canonical-json.js";
import { parseNpmLockfile } from "#core/dependency-graph.js";
import {
  DEPENDENCY_INSTALL_SCHEMA,
  installReason,
  planFetches,
  refuses,
  type DependencyInstallReceipt,
  type InstallFetch,
  type InstallInputs,
  type InstallReason,
} from "#core/dependency-install.js";
import { dependencyPolicyRevision, type DependencyPolicy } from "#core/dependency-policy.js";
import type { VerifyDependencies } from "#core/schemas/verify-dependencies-schema.js";
import { gitRun } from "#git/git.js";
import { parseVerifyYaml } from "#verify/contract.js";
import { judgeDependencies } from "#verify/dependencies.js";
import { changedFiles } from "#verify/diff.js";

/**
 * The plan of `gantry npm ci` (issue #355 slice 4, ADR-0062 decision 5): trusted inputs and admission, before any
 * network access or npm run. The policy is the base commit's `verify.yaml` section only (no task contract), and the
 * head lockfile is judged by the slice-3 reader, which reads approvals, allowed signers, the base graph and the
 * baseline from the base commit, whether or not the change touched the lockfile. The result is serializable data:
 * the inputs digests, the admitted artifact set and the admission section, which is what a broker would bind as the
 * `dependency.materialize` resource (ADR-0063 section 9). The executor re-checks the digests before materializing.
 */

export interface NpmCiRequest {
  /** A directory inside the repository. */
  root: string;
  /** The project directory, relative to `root`; it holds the lockfile and receives `node_modules`. */
  dir: string;
  /** The base commit (or a ref naming it) whose policy and approvals are the authority. */
  base: string;
  /** Run approved install scripts unconfined and label the receipt `audit` (never under a prevention claim). */
  auditUnconfinedScripts: boolean;
  /** UTC timestamp approvals are judged at; the clock by default. */
  now?: string;
}

export interface NpmCiPlan {
  request: NpmCiRequest;
  /** Absolute path of the repository top level. */
  top: string;
  base: string;
  head: string;
  directory: string;
  lockfile: string;
  lockText: string;
  manifestText: string | null;
  policy: DependencyPolicy;
  inputs: InstallInputs;
  admission: VerifyDependencies;
  fetches: InstallFetch[];
}

export type NpmCiPlanned = { plan: NpmCiPlan; receipt: null } | { plan: null; receipt: DependencyInstallReceipt };

const VERIFY_YAML = "verify.yaml";
const ALLOWED_SIGNERS = ".gitagent/foreman/PLANNER.signing.pub";
const LOCKFILES = ["npm-shrinkwrap.json", "package-lock.json"];

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const posixJoin = (dir: string, name: string): string => (dir === "." ? name : `${dir}/${name}`);

/** A receipt with the fixed no-prevention fields and empty defaults. */
export function installReceipt(fields: Partial<DependencyInstallReceipt> & { reasons: InstallReason[] }): DependencyInstallReceipt {
  return {
    schema: DEPENDENCY_INSTALL_SCHEMA,
    outcome: refuses(fields.reasons) ? "refused" : "installed",
    enforcement: "enforce",
    prevention: false,
    preventive_capability: null,
    direct_installers_blocked: false,
    base: null,
    head: null,
    directory: ".",
    lockfile: null,
    inputs: null,
    npm: null,
    admission: null,
    packages: [],
    scripts: [],
    ...fields,
  };
}

function readOrNull(abs: string): string | null {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

function revParse(top: string, ref: string): string | null {
  const r = gitRun(top, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  return r.ok ? r.stdout.trim() : null;
}

type Policy = { policy: DependencyPolicy; verifyYaml: string } | { reason: InstallReason };

/** The `dependencies` section of the base commit's `verify.yaml`, the only authority (ADR-0062 owner decision 2). */
function basePolicy(top: string, base: string): Policy {
  const r = gitRun(top, ["cat-file", "blob", `${base}:${VERIFY_YAML}`]);
  if (!r.ok) return { reason: installReason("policy_missing", "hold", VERIFY_YAML, `the base commit has no ${VERIFY_YAML}`) };
  try {
    const policy = parseVerifyYaml(r.stdout).dependencies;
    if (!policy) return { reason: installReason("policy_missing", "hold", VERIFY_YAML, `the base ${VERIFY_YAML} has no dependencies section`) };
    return { policy, verifyYaml: r.stdout };
  } catch (e) {
    return { reason: installReason("policy_invalid", "hold", VERIFY_YAML, (e as Error).message) };
  }
}

/** Digests of every input the admission read: the policy, approvals and signers at base, the lockfile and manifest on disk. */
function inputsAt(top: string, base: string, policy: DependencyPolicy, verifyYaml: string, lockText: string, manifestText: string | null): InstallInputs {
  const listed = gitRun(top, ["ls-tree", "-r", "-z", "--full-tree", base, "--", ...policy.approvalRefs]);
  const approvals = (listed.ok ? listed.stdout.split("\0").filter(Boolean) : []).map((l) => [l.slice(l.indexOf("\t") + 1), l.slice(0, l.indexOf("\t"))]);
  const signers = gitRun(top, ["cat-file", "blob", `${base}:${ALLOWED_SIGNERS}`]);
  return {
    verify_yaml: sha256(verifyYaml),
    policy_revision: dependencyPolicyRevision(policy),
    lockfile: sha256(lockText),
    manifest: manifestText === null ? null : sha256(manifestText),
    approvals: sha256(canonicalJson(approvals)),
    allowed_signers: signers.ok ? sha256(signers.stdout) : null,
  };
}

/**
 * The inputs as they are now, for the check-before-use: the base ref must still name the same commit, and every
 * digest must be unchanged. Returns the names of the inputs that changed (empty when none did).
 */
export function changedInputs(plan: NpmCiPlan): string[] {
  const base = revParse(plan.top, plan.request.base);
  if (base !== plan.base) return ["base"];
  const p = basePolicy(plan.top, base);
  if ("reason" in p) return ["verify_yaml"];
  const projectDir = path.join(plan.top, ...plan.directory.split("/").filter((s) => s !== "."));
  const lockText = readOrNull(path.join(projectDir, path.basename(plan.lockfile)));
  if (lockText === null) return ["lockfile"];
  const now = inputsAt(plan.top, base, p.policy, p.verifyYaml, lockText, readOrNull(path.join(projectDir, "package.json")));
  return (Object.keys(now) as (keyof InstallInputs)[]).filter((k) => now[k] !== plan.inputs[k]);
}

interface Located {
  top: string;
  base: string;
  head: string;
  directory: string;
}

function locate(req: NpmCiRequest): Located | InstallReason {
  const t = gitRun(path.resolve(req.root), ["rev-parse", "--show-toplevel"]);
  if (!t.ok || !t.stdout.trim()) return installReason("not_a_repository", "hold", null, "not inside a git work tree");
  const top = fs.realpathSync(t.stdout.trim());
  const base = revParse(top, req.base);
  if (base === null) return installReason("base_invalid", "hold", null, `base ${req.base} does not name a commit`);
  const head = revParse(top, "HEAD");
  if (head === null) return installReason("base_invalid", "hold", null, "the repository has no commit at HEAD");
  const abs = path.resolve(req.root, req.dir);
  const rel = path.relative(top, fs.existsSync(abs) ? fs.realpathSync(abs) : abs).split(path.sep).join("/");
  if (rel.startsWith("..") || path.isAbsolute(rel)) return installReason("directory_outside_repository", "hold", req.dir, "the project directory is outside the repository");
  return { top, base, head, directory: rel === "" ? "." : rel };
}

/** Plan an install: trusted inputs, then admission of the head lockfile. Refuses before any network access or npm run. */
export function planNpmCi(req: NpmCiRequest): NpmCiPlanned {
  const refused = (reasons: InstallReason[], fields: Partial<DependencyInstallReceipt> = {}): NpmCiPlanned => ({ plan: null, receipt: installReceipt({ ...fields, reasons }) });
  const where = locate(req);
  if ("code" in where) return refused([where], { directory: req.dir });
  const { top, base, head, directory } = where;
  const at = { base, head, directory };
  const p = basePolicy(top, base);
  if ("reason" in p) return refused([p.reason], at);
  const { policy, verifyYaml } = p;
  const projectDir = path.join(top, ...directory.split("/").filter((s) => s !== "."));
  const name = LOCKFILES.find((l) => fs.existsSync(path.join(projectDir, l)));
  if (!name) return refused([installReason("lockfile_missing", "hold", directory, "no npm-shrinkwrap.json or package-lock.json in the project directory")], at);
  // npm ci needs a package.json; without one npm would walk up to a parent folder's package.json and .npmrc.
  if (!fs.existsSync(path.join(projectDir, "package.json"))) return refused([installReason("manifest_missing", "hold", directory, "no package.json in the project directory; npm ci needs one")], at);
  const lockfile = posixJoin(directory, name);
  const read = () => ({ lockText: readOrNull(path.join(projectDir, name)) ?? "", manifestText: readOrNull(path.join(projectDir, "package.json")) });
  const before = read();
  const inputs = inputsAt(top, base, policy, verifyYaml, before.lockText, before.manifestText);
  const enforcement = policy.mode === "audit" ? "audit" : "enforce";
  const now = req.now ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const admission = judgeDependencies({ root: top, base, head, worktree: true, changed: changedFiles(top, base, true), policy, now, judge: [lockfile] });
  const fields = { ...at, lockfile, inputs, admission, enforcement } as const;
  const after = read();
  if (after.lockText !== before.lockText || after.manifestText !== before.manifestText) {
    return refused([installReason("inputs_changed", "hold", lockfile, "the lockfile or package.json changed while admission read it")], fields);
  }
  if (admission.outcome !== "pass") {
    const codes = [...new Set(admission.reasons.filter((r) => r.severity !== "info").map((r) => r.code))].join(", ");
    return refused([installReason("admission_not_pass", admission.outcome === "fail" ? "fail" : "hold", lockfile, `dependency admission is ${admission.outcome} (${codes}); nothing was fetched`)], fields);
  }
  const graph = parseNpmLockfile(before.lockText, { ...(before.manifestText === null ? {} : { manifest: before.manifestText }), limits: policy.limits });
  if (graph.status !== "ok") return refused([installReason("admission_not_pass", "hold", lockfile, graph.detail)], fields);
  const { fetches, reasons } = planFetches(graph.graph, before.lockText, policy.registries);
  if (refuses(reasons)) return refused(reasons, fields);
  return { plan: { request: req, top, base, head, directory, lockfile, lockText: before.lockText, manifestText: before.manifestText, policy, inputs, admission, fetches }, receipt: null };
}
