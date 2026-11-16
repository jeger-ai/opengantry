import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { APPROVAL_SIGNATURE_NAMESPACE, approvalSignedMessage, sshSignatureSignedData } from "#core/dependency-approval.js";
import { parseNpmLockfile, type NpmGraph } from "#core/dependency-graph.js";
import { dependencyPolicyRevision } from "#core/dependency-policy.js";
import { lockfileUpdateProblem, manifestUpdateProblem } from "#core/dependency-update.js";
import { verifyDependenciesProblem } from "#core/schemas/verify-dependencies-schema.js";
import { getRepoRoot, gitChildEnv } from "#git/git.js";
import { mergeRepositoryLaw, parseVerifyYaml } from "#verify/contract.js";
import { contentDigestAt } from "#verify/dependencies.js";
import { verifyResultJUnit, verifyResultSarif } from "#verify/export.js";
import { checkKeylessSignature, GITHUB_ACTIONS_ISSUER, signVerifyResultKeyless, type SigstoreApi, type SigstoreBundle } from "#verify/keyless.js";
import { checkVerifyResult, runVerifyContract, type VerifyContractResult } from "#verify/run.js";

/**
 * Issue #355 slice 3 (MSN-0383): dependency admission in `gantry verify --contract`, end to end in temp git
 * repositories. Every authority input is read from the base commit; the result section is v2, signed, and refused
 * by v1 readers.
 */

const CLI = path.join(getRepoRoot(), "dist", "cli", "index.js");
const REG = "https://registry.npmjs.org/";
const NOW = "2026-11-16T12:00:00Z";
const HAS_SSH_KEYGEN = spawnSync("ssh-keygen", ["-?"], { encoding: "utf8" }).error === undefined;
const NEEDS_SSH = { skip: HAS_SSH_KEYGEN ? false : "ssh-keygen not available" };

// --- fixtures -------------------------------------------------------------------------------------------------

type Packages = Record<string, unknown>;
const reg = (name: string, version: string, extra: Record<string, unknown> = {}) => ({
  version,
  resolved: `${REG}${name}/-/${name}-${version}.tgz`,
  integrity: `sha512-${name}-${version}`,
  ...extra,
});
const lock = (deps: Record<string, string>, extra: Packages = {}, version = 3) =>
  `${JSON.stringify({ name: "app", version: "1.0.0", lockfileVersion: version, requires: true, packages: { "": { name: "app", version: "1.0.0", dependencies: deps }, ...extra } }, null, 2)}\n`;
const manifest = (deps: Record<string, string>) => `${JSON.stringify({ name: "app", version: "1.0.0", dependencies: deps }, null, 2)}\n`;

const BASE_DEPS = { a: "^1.0.0" };
const BASE_PKGS: Packages = { "node_modules/a": reg("a", "1.0.0", { dependencies: { t: "^2.0.0" } }), "node_modules/t": reg("t", "2.0.0") };
const ADDED_DEPS = { a: "^1.0.0", b: "^1.0.0" };
const ADDED_PKGS: Packages = { ...BASE_PKGS, "node_modules/b": reg("b", "1.0.0") };

function graph(lockText: string, manifestText: string): NpmGraph {
  const r = parseNpmLockfile(lockText, { manifest: manifestText });
  assert.equal(r.status, "ok", r.status === "hold" ? `${r.code}: ${r.detail}` : "");
  return (r as { graph: NpmGraph }).graph;
}
const BASE_GRAPH = graph(lock(BASE_DEPS, BASE_PKGS), manifest(BASE_DEPS));
const ADDED_GRAPH = graph(lock(ADDED_DEPS, ADDED_PKGS), manifest(ADDED_DEPS));

function policyYaml(mode: "audit" | "enforce", baseline: string | null = BASE_GRAPH.digest): string {
  return [
    "schema: opengantry.verify.v1",
    "dependencies:",
    "  schema: opengantry.dependency-policy.v1",
    `  mode: ${mode}`,
    "  ecosystems:",
    "    npm:",
    "      lockfile_versions: [2, 3]",
    '      npm_version: "11.6.2"',
    "  registries:",
    `    - ${REG}`,
    ...(baseline ? [`  approved_baseline_digest: "${baseline}"`] : []),
    "  lifecycle:",
    "    default: deny",
    "",
  ].join("\n");
}
const policyOf = (mode: "audit" | "enforce", baseline: string | null = BASE_GRAPH.digest) => parseVerifyYaml(policyYaml(mode, baseline)).dependencies!;

function sshString(b: Buffer | string): Buffer {
  const body = typeof b === "string" ? Buffer.from(b) : b;
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  return Buffer.concat([len, body]);
}
interface Key {
  priv: KeyObject;
  blob: Buffer;
}
function newKey(): Key {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
  return { priv: privateKey, blob: Buffer.concat([sshString("ssh-ed25519"), sshString(raw)]) };
}
function sshsig(key: Key, message: string): string {
  const sig = sign(null, sshSignatureSignedData(message, APPROVAL_SIGNATURE_NAMESPACE, "sha512"), key.priv);
  const blob = Buffer.concat([
    Buffer.from("SSHSIG"),
    Buffer.from([0, 0, 0, 1]),
    sshString(key.blob),
    sshString(APPROVAL_SIGNATURE_NAMESPACE),
    sshString(""),
    sshString("sha512"),
    sshString(Buffer.concat([sshString("ssh-ed25519"), sshString(sig)])),
  ]);
  return `-----BEGIN SSH SIGNATURE-----\n${blob.toString("base64")}\n-----END SSH SIGNATURE-----\n`;
}
const PLANNER = newKey();
const ATTACKER = newKey();
const signersFor = (k: Key) => `planner@example.com ssh-ed25519 ${k.blob.toString("base64")}\n`;

const ident = (g: NpmGraph, location: string) => {
  const n = g.nodes.find((x) => x.location === location)!;
  return { name: n.name, version: n.version, source: { kind: n.source.kind, ref: n.source.ref }, integrity: n.integrity };
};

function approvalText(o: { head: NpmGraph; mode?: "audit" | "enforce"; identities?: unknown[]; files?: unknown[]; key?: Key }): string {
  const body = {
    schema: "opengantry.dependency-approval.v1",
    lockfile: "package-lock.json",
    graph_digest: o.head.digest,
    policy_revision: dependencyPolicyRevision(policyOf(o.mode ?? "enforce")),
    identities: o.identities ?? [],
    lifecycle: [],
    root_scripts: [],
    files: o.files ?? [],
    approver: "planner@example.com",
    issued_at: "2026-11-16T00:00:00Z",
    expires_at: "2026-12-16T00:00:00Z",
  };
  return `${JSON.stringify({ ...body, signature: sshsig(o.key ?? PLANNER, approvalSignedMessage(body)) }, null, 2)}\n`;
}

function git(dest: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", dest, "-c", "user.email=fixture@example.com", "-c", "user.name=Fixture", "-c", "commit.gpgsign=false", ...args], {
    encoding: "utf8",
    env: gitChildEnv(),
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function write(dest: string, files: Record<string, string | null>): void {
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(dest, rel);
    if (text === null) fs.rmSync(abs, { force: true });
    else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text);
    }
  }
}

function commit(dest: string, files: Record<string, string | null>, message: string, author?: string): string {
  write(dest, files);
  git(dest, "add", "-A");
  git(dest, ...(author ? ["-c", `user.email=${author}`] : []), "commit", "-q", "-m", message);
  return git(dest, "rev-parse", "HEAD");
}

const temps: string[] = [];
test.after(() => {
  for (const t of temps) fs.rmSync(t, { recursive: true, force: true });
});
function tmp(prefix: string): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  temps.push(d);
  return d;
}

/** A repository whose base commit holds the policy, the lockfile, its manifest, the allowed signers and `extra`. */
function repo(mode: "audit" | "enforce", extra: Record<string, string> = {}): { dest: string; base: string } {
  const dest = tmp("og-verify-depadm-");
  git(dest, "init", "-q", "-b", "main");
  const base = commit(
    dest,
    {
      "verify.yaml": policyYaml(mode),
      "package.json": manifest(BASE_DEPS),
      "package-lock.json": lock(BASE_DEPS, BASE_PKGS),
      ".gitagent/foreman/PLANNER.signing.pub": signersFor(PLANNER),
      ...extra,
    },
    "base",
  );
  return { dest, base };
}

const ADD_B = { "package.json": manifest(ADDED_DEPS), "package-lock.json": lock(ADDED_DEPS, ADDED_PKGS) };
const run = (dest: string, base: string, extra: Partial<Parameters<typeof runVerifyContract>[0]> = {}): VerifyContractResult =>
  runVerifyContract({ cwd: dest, base, now: NOW, ...extra });
const codes = (r: VerifyContractResult) => r.dependencies!.reasons.map((x) => x.code);

// --- tests ----------------------------------------------------------------------------------------------------

test("verify --contract: an unapproved addition holds under enforce and fails the run; the section is v2 and digest-only (MSN-0383)", () => {
  const { dest, base } = repo("enforce");
  const head = commit(dest, ADD_B, "add b");
  const r = run(dest, base);
  assert.equal(r.schema, "opengantry.verify-result.v2");
  assert.equal(r.status, "fail");
  assert.match(r.problems.join("\n"), /dependencies: hold under mode enforce \(unapproved_identity\)/);
  const d = r.dependencies!;
  assert.equal(verifyDependenciesProblem(d), null, "the section matches the core schema");
  assert.deepEqual(
    { outcome: d.outcome, mode: d.mode, enforcement: d.enforcement, base: d.base, head: d.head, ecosystems: d.ecosystems, files: d.files },
    { outcome: "hold", mode: "enforce", enforcement: "audit", base, head, ecosystems: ["npm"], files: ["package-lock.json", "package.json"] },
  );
  assert.equal(d.policy_revision, dependencyPolicyRevision(policyOf("enforce")));
  assert.deepEqual(d.lockfiles.map((l) => [l.path, l.outcome, l.base_graph, l.head_graph]), [["package-lock.json", "hold", BASE_GRAPH.digest, ADDED_GRAPH.digest]]);
  assert.match(d.lockfiles[0]!.graph_diff ?? "", /^[0-9a-f]{64}$/);
  assert.deepEqual(codes(r), ["unapproved_identity"]);
  assert.equal(d.reasons[0]!.location, "node_modules/b");
  assert.ok(!JSON.stringify(d).includes('"packages"'), "no lockfile source in the section");
});

test("verify --contract: under audit the same hold is reported and labelled but does not fail the run (MSN-0383)", () => {
  const { dest, base } = repo("audit");
  commit(dest, ADD_B, "add b");
  const r = run(dest, base);
  assert.equal(r.status, "pass");
  assert.deepEqual(r.problems, []);
  assert.deepEqual([r.dependencies!.outcome, r.dependencies!.mode, r.dependencies!.enforcement], ["hold", "audit", "audit"]);
  const sarif = JSON.stringify(verifyResultSarif(r, "0.0.0"));
  assert.match(sarif, /"ruleId":"verify\/dependency-unapproved-identity","level":"warning"/);
  assert.match(verifyResultJUnit(r), /name="dependencies \(audit\)"><skipped\/>/);
});

test("verify --contract: an addition approved at base for exactly this head graph passes (MSN-0383)", () => {
  const approval = approvalText({ head: ADDED_GRAPH, identities: [ident(ADDED_GRAPH, "node_modules/b")] });
  const { dest, base } = repo("enforce", { ".gitagent/dependency-approvals/b.json": approval });
  commit(dest, ADD_B, "add b");
  const r = run(dest, base);
  assert.equal(r.status, "pass", r.problems.join("\n"));
  assert.equal(r.dependencies!.outcome, "pass");
  assert.equal(r.dependencies!.approvals_used.length, 1);
  assert.deepEqual(r.dependencies!.lockfiles[0]!.approvals_used, r.dependencies!.approvals_used);
  assert.match(verifyResultJUnit(r), /<testcase classname="gantry.verify.contract" name="dependencies"\/>/);
});

test("verify --contract: approvals, signers, policy and baseline the candidate edits in head are ignored; authority is the base (MSN-0383)", () => {
  const { dest, base } = repo("enforce");
  const forged = approvalText({ head: ADDED_GRAPH, identities: [ident(ADDED_GRAPH, "node_modules/b")], key: ATTACKER });
  const planner = approvalText({ head: ADDED_GRAPH, identities: [ident(ADDED_GRAPH, "node_modules/b")] });
  commit(
    dest,
    {
      ...ADD_B,
      "verify.yaml": policyYaml("audit", ADDED_GRAPH.digest),
      ".gitagent/foreman/PLANNER.signing.pub": signersFor(ATTACKER),
      ".gitagent/dependency-approvals/forged.json": forged,
      ".gitagent/dependency-approvals/planner.json": planner,
    },
    "candidate adds b, loosens the policy, imports its own baseline, swaps the signers and adds approvals",
  );
  const r = run(dest, base);
  assert.equal(r.status, "fail");
  const d = r.dependencies!;
  assert.equal(d.mode, "enforce", "the base policy decides the mode");
  assert.equal(d.policy_revision, dependencyPolicyRevision(policyOf("enforce")), "and the baseline");
  assert.deepEqual(d.approvals_used, [], "approvals added in head are not authority");
  assert.deepEqual(codes(r), ["unapproved_identity"]);
});

test("verify --contract: a candidate's own approvals cannot admit through worktree mode either (MSN-0383)", () => {
  const { dest, base } = repo("enforce");
  write(dest, { ...ADD_B, ".gitagent/dependency-approvals/b.json": approvalText({ head: ADDED_GRAPH, identities: [ident(ADDED_GRAPH, "node_modules/b")] }) });
  const r = run(dest, base, { mode: "worktree" });
  assert.equal(r.dependencies!.outcome, "hold");
  assert.deepEqual(codes(r), ["unapproved_identity"]);
});

test("verify --contract: unsupported lockfiles hold, under enforce and labelled under audit (MSN-0383)", () => {
  for (const mode of ["enforce", "audit"] as const) {
    const { dest, base } = repo(mode);
    commit(dest, { "yarn.lock": "# yarn lockfile v1\n", "pkgs/x/pnpm-lock.yaml": "lockfileVersion: '9.0'\n" }, "other package managers");
    const r = run(dest, base);
    assert.deepEqual(codes(r), ["unsupported_dependency_file", "unsupported_dependency_file"]);
    assert.equal(r.dependencies!.outcome, "hold");
    assert.equal(r.status, mode === "enforce" ? "fail" : "pass");
  }
  const { dest, base } = repo("enforce");
  commit(dest, { "package-lock.json": lock(BASE_DEPS, BASE_PKGS, 1) }, "lockfile v1");
  const v1 = run(dest, base);
  assert.equal(v1.status, "fail");
  assert.deepEqual(codes(v1), ["graph_hold"]);
  assert.match(v1.dependencies!.reasons[0]!.detail, /unsupported_lockfile/);
});

test("verify --contract: a manifest change without its lockfile, or disagreeing with it, holds (MSN-0383)", () => {
  const { dest, base } = repo("enforce");
  commit(dest, { "package.json": manifest(ADDED_DEPS) }, "manifest only");
  const r = run(dest, base);
  assert.equal(r.status, "fail");
  assert.deepEqual(codes(r), ["manifest_without_lock_change"]);
  assert.deepEqual(r.dependencies!.lockfiles, []);

  const other = repo("enforce");
  commit(other.dest, { "package.json": manifest({ ...ADDED_DEPS, c: "^1.0.0" }), "package-lock.json": lock(ADDED_DEPS, ADDED_PKGS) }, "manifest and lock disagree");
  assert.ok(codes(run(other.dest, other.base)).includes("manifest_lock_mismatch"));

  const nested = repo("enforce");
  commit(nested.dest, { "tools/x/package.json": manifest({ y: "^1.0.0" }) }, "a nested package");
  assert.deepEqual(codes(run(nested.dest, nested.base)), ["manifest_without_lock_change"], "the root lockfile governs it, and it did not change");

  const dest2 = tmp("og-verify-depadm-nolock-");
  git(dest2, "init", "-q", "-b", "main");
  const base2 = commit(dest2, { "verify.yaml": policyYaml("enforce") }, "base without a lockfile");
  commit(dest2, { "package.json": manifest(ADDED_DEPS) }, "a manifest without any lockfile");
  assert.deepEqual(codes(run(dest2, base2)), ["manifest_without_lockfile"]);
});

test("verify --contract: a nested manifest is governed by the nearest lockfile; node_modules content and a removed lockfile hold (MSN-0383)", () => {
  const { dest, base } = repo("enforce");
  commit(dest, { "tools/x/package.json": manifest({ y: "^1.0.0" }), "node_modules/a/index.js": "evil()\n", "package-lock.json": null }, "nested, vendored, no lock");
  const r = run(dest, base);
  assert.deepEqual(codes(r).sort(), ["lockfile_missing", "manifest_without_lockfile", "node_modules_changed"]);
});

test("verify --contract: no dependency change still records a v2 section that passes (MSN-0383)", () => {
  const { dest, base } = repo("enforce");
  commit(dest, { "src/app.ts": "export const x = 1;\n" }, "code only");
  const r = run(dest, base);
  assert.equal(r.status, "pass");
  assert.deepEqual([r.schema, r.dependencies!.outcome, r.dependencies!.files, r.dependencies!.lockfiles], ["opengantry.verify-result.v2", "pass", [], []]);
});

test("verify --contract: a contract without a dependencies section keeps the v1 result unchanged (MSN-0383)", () => {
  const dest = tmp("og-verify-depadm-v1-");
  git(dest, "init", "-q", "-b", "main");
  const base = commit(dest, { "verify.yaml": "schema: opengantry.verify.v1\n" }, "base");
  commit(dest, ADD_B, "add b");
  const r = run(dest, base);
  assert.equal(r.schema, "opengantry.verify-result.v1");
  assert.ok(!Object.hasOwn(r, "dependencies"));
});

test("verify --contract: a task contract cannot supply a dependencies policy without a base floor (MSN-0383)", () => {
  const dest = tmp("og-verify-depadm-task-");
  git(dest, "init", "-q", "-b", "main");
  const base = commit(dest, { "README.md": "x\n" }, "base without verify.yaml");
  commit(dest, ADD_B, "add b");
  const task = path.join(tmp("og-verify-depadm-taskfile-"), "task.yaml");
  fs.writeFileSync(task, policyYaml("audit", null));
  assert.throws(
    () => runVerifyContract({ cwd: dest, base, contract: task, now: NOW }),
    (e: unknown) => (e as { code?: string }).code === "GXT_VERIFY_CONTRACT_INVALID" && /cannot supply a dependencies policy/.test((e as Error).message),
  );
  assert.throws(
    () => mergeRepositoryLaw(parseVerifyYaml(policyYaml("enforce", null)), parseVerifyYaml("schema: opengantry.verify.v1\n")),
    /a task contract cannot supply a dependencies policy/,
    "a repository verify.yaml without the section is no floor either",
  );
  const merged = mergeRepositoryLaw(parseVerifyYaml("schema: opengantry.verify.v1\n"), parseVerifyYaml(policyYaml("enforce", null)));
  assert.equal(merged.dependencies?.mode, "enforce", "a task without the section inherits the repository's");
});

test("verify --contract: a dependency_update bump ADR-0057 accepts still holds without approval and passes with one (MSN-0383, DEP-T04)", () => {
  const bumpDeps = { a: "^1.0.1" };
  const bumpPkgs: Packages = { ...BASE_PKGS, "node_modules/a": reg("a", "1.0.1", { dependencies: { t: "^2.0.0" } }) };
  const bump = { "package.json": manifest(bumpDeps), "package-lock.json": lock(bumpDeps, bumpPkgs) };
  assert.equal(manifestUpdateProblem(JSON.parse(manifest(BASE_DEPS)), JSON.parse(bump["package.json"])), null, "a bump the exemption accepts");
  assert.equal(lockfileUpdateProblem(JSON.parse(lock(BASE_DEPS, BASE_PKGS)), JSON.parse(bump["package-lock.json"]), [REG]), null, "a bump the exemption accepts");

  const { dest, base } = repo("enforce");
  commit(dest, bump, "chore(deps): bump a", "dependabot[bot]@users.noreply.github.com");
  const r = run(dest, base);
  assert.equal(r.status, "fail");
  assert.deepEqual(codes(r), ["unapproved_identity"]);

  const bumped = graph(bump["package-lock.json"], bump["package.json"]);
  const approved = repo("enforce", { ".gitagent/dependency-approvals/a.json": approvalText({ head: bumped, identities: [ident(bumped, "node_modules/a")] }) });
  commit(approved.dest, bump, "chore(deps): bump a", "dependabot[bot]@users.noreply.github.com");
  const ok = run(approved.dest, approved.base);
  assert.equal(ok.status, "pass", ok.problems.join("\n"));
});

test("verify --contract: a file: folder is admitted by its content digest at base, and not when the change edits it (MSN-0383)", () => {
  const folderDeps = { a: "^1.0.0", x: "file:vendor/x" };
  const folderPkgs: Packages = { ...BASE_PKGS, "node_modules/x": { resolved: "vendor/x", link: true }, "vendor/x": { name: "x", version: "1.0.0" } };
  const files = { "package.json": manifest(folderDeps), "package-lock.json": lock(folderDeps, folderPkgs) };
  const head = graph(files["package-lock.json"], files["package.json"]);

  const dest = tmp("og-verify-depadm-file-");
  git(dest, "init", "-q", "-b", "main");
  const first = commit(dest, { "vendor/x/package.json": '{"name":"x","version":"1.0.0"}\n', "vendor/x/index.js": "module.exports = 1;\n" }, "vendor x");
  const digest = contentDigestAt(dest, first, "vendor/x");
  assert.match(digest ?? "", /^[0-9a-f]{64}$/);
  assert.equal(contentDigestAt(dest, first, "vendor/missing"), null);
  const base = commit(
    dest,
    {
      "verify.yaml": policyYaml("enforce"),
      "package.json": manifest(BASE_DEPS),
      "package-lock.json": lock(BASE_DEPS, BASE_PKGS),
      ".gitagent/foreman/PLANNER.signing.pub": signersFor(PLANNER),
      ".gitagent/dependency-approvals/x.json": approvalText({ head, files: [{ path: "vendor/x", content_digest: digest }] }),
    },
    "base",
  );
  assert.equal(contentDigestAt(dest, base, "vendor/x"), digest, "unrelated commits do not change it");
  const work = commit(dest, files, "depend on vendor/x");
  assert.equal(run(dest, base).status, "pass", run(dest, base).problems.join("\n"));

  git(dest, "reset", "-q", "--hard", work);
  commit(dest, { "vendor/x/index.js": "module.exports = evil();\n" }, "and edit it");
  assert.deepEqual(codes(run(dest, base)), ["source_file"]);
});

test("verify --check-result: a v2 result binds its dependency section; a v1 reader refuses it; malformed and stripped sections are refused (MSN-0383, DEP06)", () => {
  const { dest, base } = repo("audit");
  commit(dest, ADD_B, "add b");
  const r = run(dest, base);
  const out = path.join(tmp("og-verify-depadm-out-"), "result.json");
  const save = (v: unknown) => fs.writeFileSync(out, `${JSON.stringify(v, null, 2)}\n`);
  const check = () => checkVerifyResult(out, { cwd: dest, base });

  save(r);
  assert.deepEqual(check().problems, []);

  // The released 4.0.x reader (checkVerifyResult before MSN-0383) accepted exactly one schema and ignored unknown
  // keys; this is its schema test, verbatim. A v2 result fails it, so an old reader refuses instead of ignoring.
  const v1Reader = (result: { schema?: unknown }) => [result.schema !== "opengantry.verify-result.v1" && "not a opengantry.verify-result.v1 result"].filter(Boolean);
  assert.deepEqual(v1Reader(r), ["not a opengantry.verify-result.v1 result"]);

  const { dependencies, ...stripped } = r;
  save({ ...stripped, schema: "opengantry.verify-result.v1" });
  assert.deepEqual(check().problems, ["the contract has a dependencies policy and the result has no dependencies section"], "a downgrade to v1 is refused");
  save({ ...r, schema: "opengantry.verify-result.v1" });
  assert.deepEqual(check().problems, ["a opengantry.verify-result.v1 result cannot carry a dependencies section"]);
  save(stripped);
  assert.deepEqual(check().problems, ["a opengantry.verify-result.v2 result must carry a dependencies section"]);
  save({ ...r, dependencies: { ...dependencies, enforcement: "prevent" } });
  assert.match(check().problems.join(), /the dependencies section is malformed \(enforcement: /);
  save({ ...r, dependencies: { ...dependencies, extra: 1 } });
  assert.match(check().problems.join(), /malformed/, "the section is closed");
  save({ ...r, dependencies: { ...dependencies, policy_revision: "0".repeat(64) } });
  assert.deepEqual(check().problems, ["the dependencies section was judged under another policy revision"]);
  save({ ...r, dependencies: { ...dependencies, base: dependencies!.head } });
  assert.deepEqual(check().problems, ["the dependencies section names another base or head than the result"]);
  save({ ...r, schema: "opengantry.verify-result.v3" });
  assert.match(check().problems.join(), /not a opengantry\.verify-result\.v1 or opengantry\.verify-result\.v2 result/);
});

function keypair(dir: string, name: string): { key: string; pub: string } {
  const key = path.join(dir, name);
  const r = spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", name, "-f", key], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return { key, pub: fs.readFileSync(`${key}.pub`, "utf8").trim() };
}

test("verify --sign: the signature covers the dependency section; tampering with the verdict is detected (MSN-0383)", NEEDS_SSH, async () => {
  const { dest, base } = repo("audit");
  commit(dest, ADD_B, "add b");
  const keys = tmp("og-verify-depadm-keys-");
  const ci = keypair(keys, "ci");
  git(dest, "config", "gpg.format", "ssh");
  git(dest, "config", "user.signingkey", `${ci.key}.pub`);
  const signers = path.join(keys, "allowed_signers");
  fs.writeFileSync(signers, `ci@example.com ${ci.pub}\n`);

  const r = run(dest, base, { sign: true });
  assert.equal(r.signature?.kind, "ssh");
  const out = path.join(keys, "result.json");
  const save = (v: unknown) => fs.writeFileSync(out, `${JSON.stringify(v, null, 2)}\n`);
  const problems = () => checkVerifyResult(out, { cwd: dest, base, allowedSigners: signers }).problems;
  save(r);
  assert.deepEqual(problems(), []);
  save({ ...r, dependencies: { ...r.dependencies!, outcome: "pass" } });
  assert.match(problems().join(), /the signature does not verify .* \(bad\)/, "a flipped outcome");
  save({ ...r, dependencies: { ...r.dependencies!, reasons: [] } });
  assert.match(problems().join(), /does not verify/, "dropped reasons");
  save({ ...r, dependencies: { ...r.dependencies!, lockfiles: [{ ...r.dependencies!.lockfiles[0]!, head_graph: BASE_GRAPH.digest }] } });
  assert.match(problems().join(), /does not verify/, "another head graph");

  // Keyless (ADR-0055) signs the same canonical payload: a stand-in Sigstore records it and compares on verify.
  const signed: Buffer[] = [];
  const sigstore: SigstoreApi = {
    sign(payload) {
      signed.push(payload);
      return Promise.resolve({ fake: payload.toString("base64"), verificationMaterial: { tlogEntries: [{ logIndex: "1" }] } } as unknown as SigstoreBundle);
    },
    verify(bundle, payload) {
      return (bundle as unknown as { fake: string }).fake === payload.toString("base64") ? Promise.resolve({ identity: { subjectAlternativeName: "ci" } }) : Promise.reject(new Error("signature mismatch"));
    },
  };
  const keyless = await signVerifyResultKeyless(run(dest, base), sigstore, { SIGSTORE_ID_TOKEN: "token" });
  assert.match(signed[0]!.toString("utf8"), /"dependencies":\{.*"enforcement":"audit"/);
  const id = { identity: "ci", issuer: GITHUB_ACTIONS_ISSUER };
  assert.equal((await checkKeylessSignature(keyless, id, sigstore)).problem, null);
  const tampered = { ...keyless, dependencies: { ...keyless.dependencies!, outcome: "pass" as const } };
  assert.match((await checkKeylessSignature(tampered, id, sigstore)).problem ?? "", /signature mismatch/);
});

test("gantry verify --contract: the CLI prints the dependency verdict and exits 1 under enforce (MSN-0383)", () => {
  const { dest, base } = repo("enforce");
  commit(dest, ADD_B, "add b");
  const r = spawnSync(process.execPath, [CLI, "verify", "--contract", "--base", base], { cwd: dest, encoding: "utf8", env: gitChildEnv() });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /^verify: dependencies HOLD \(mode enforce; 2 changed dependency file\(s\); a post-change check, not prevention\)$/m);
  assert.match(r.stderr, /^verify: dependencies hold unapproved_identity package-lock\.json node_modules\/b: /m);
});
