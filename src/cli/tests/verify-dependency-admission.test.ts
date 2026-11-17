import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { APPROVAL_SIGNATURE_NAMESPACE, approvalSignedMessage, sshSignatureSignedData } from "#core/dependency-approval.js";
import { parseNpmLockfile, type NpmGraph } from "#core/dependency-graph.js";
import { dependencyPolicyRevision } from "#core/dependency-policy.js";
import { lockfileUpdateProblem, manifestUpdateProblem } from "#core/dependency-update.js";
import { verifyDependenciesProblem } from "#core/schemas/verify-dependencies-schema.js";
import { getRepoRoot, gitChildEnv } from "#git/git.js";
import { mergeRepositoryLaw, parseVerifyYaml } from "#verify/contract.js";
import { contentDigestAt, judgeDependencies } from "#verify/dependencies.js";
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

test("verify --contract: approvals are checked against the base allowed signers, not a head swap (MSN-0383 review)", () => {
  const forged = approvalText({ head: ADDED_GRAPH, identities: [ident(ADDED_GRAPH, "node_modules/b")], key: ATTACKER });
  const { dest, base } = repo("enforce", { ".gitagent/dependency-approvals/b.json": forged });
  commit(dest, { ...ADD_B, ".gitagent/foreman/PLANNER.signing.pub": signersFor(ATTACKER) }, "add b and swap the signers to the key that signed the approval");
  const r = run(dest, base);
  assert.equal(r.status, "fail");
  assert.equal(r.dependencies!.outcome, "fail");
  assert.deepEqual(codes(r).sort(), ["approval_signature_invalid", "unapproved_identity"]);
  assert.deepEqual(r.dependencies!.approvals_used, []);
});

test("verify --contract: case variants of dependency file names hold, under enforce and labelled under audit (MSN-0383 review)", () => {
  for (const mode of ["enforce", "audit"] as const) {
    const { dest, base } = repo(mode);
    commit(dest, { "sub/PACKAGE-LOCK.JSON": lock(ADDED_DEPS, ADDED_PKGS), "tools/Package.json": manifest({ y: "^1.0.0" }), "Node_Modules/a/index.js": "evil()\n", "Yarn.lock": "#\n" }, "case variants");
    const r = run(dest, base);
    assert.deepEqual(r.dependencies!.files, ["Node_Modules/a/index.js", "Yarn.lock", "sub/PACKAGE-LOCK.JSON", "tools/Package.json"]);
    assert.deepEqual(r.dependencies!.reasons.map((x) => [x.code, x.file]), [
      ["node_modules_changed", "Node_Modules/a/index.js"],
      ["unsupported_dependency_file", "Yarn.lock"],
      ["unsupported_dependency_file", "sub/PACKAGE-LOCK.JSON"],
      ["unsupported_dependency_file", "tools/Package.json"],
    ]);
    assert.match(r.dependencies!.reasons[2]!.detail, /case variant of package-lock\.json/);
    assert.equal(r.status, mode === "enforce" ? "fail" : "pass");
    if (mode === "audit") assert.match(verifyResultJUnit(r), /name="dependencies \(audit\)"><skipped\/>/);
  }
});

test("verify --contract: an added, changed or removed .npmrc holds at any depth (MSN-0383 review)", () => {
  for (const mode of ["enforce", "audit"] as const) {
    const { dest, base } = repo(mode, { ".npmrc": "registry=https://registry.npmjs.org/\n", "tools/.npmrc": "ignore-scripts=true\n" });
    commit(dest, { ".npmrc": "registry=https://evil.example/\n", "tools/.npmrc": null, "pkgs/x/.npmrc": "//evil.example/:_authToken=x\n", "docs/.NPMRC": "x\n" }, "npm config");
    const r = run(dest, base);
    assert.deepEqual(r.dependencies!.reasons.map((x) => [x.code, x.file]), [
      ["npm_config_changed", ".npmrc"],
      ["unsupported_dependency_file", "docs/.NPMRC"],
      ["npm_config_changed", "pkgs/x/.npmrc"],
      ["npm_config_changed", "tools/.npmrc"],
    ]);
    assert.deepEqual(r.dependencies!.reasons.filter((x) => x.code === "npm_config_changed").map((x) => /was (\w+)/.exec(x.detail)![1]), ["changed", "added", "removed"]);
    assert.ok(!JSON.stringify(r.dependencies).includes("evil.example"), "no npm config content in the section");
    assert.equal(r.status, mode === "enforce" ? "fail" : "pass");
  }
});

test("verify --contract: editing an approved file: folder holds although the lockfile did not change; an approval of the new content admits it (MSN-0383 review)", () => {
  const folderDeps = { a: "^1.0.0", x: "file:vendor/x" };
  const folderPkgs: Packages = { ...BASE_PKGS, "node_modules/x": { resolved: "vendor/x", link: true }, "vendor/x": { name: "x", version: "1.0.0" } };
  const files = { "package.json": manifest(folderDeps), "package-lock.json": lock(folderDeps, folderPkgs) };
  const head = graph(files["package-lock.json"], files["package.json"]);
  const vendored = { "vendor/x/package.json": '{"name":"x","version":"1.0.0"}\n', "vendor/x/index.js": "module.exports = 1;\n" };
  const edited = { "vendor/x/index.js": "module.exports = evil();\n" };
  const scripted = { "vendor/x/package.json": '{"name":"x","version":"1.0.0","scripts":{"install":"node evil.js"}}\n' };

  /** Base: the folder, the lockfile depending on it and an approval for the folder's digests in `approve`. */
  const setup = (approve: (dest: string, first: string) => string[]) => {
    const dest = tmp("og-verify-depadm-folder-");
    git(dest, "init", "-q", "-b", "main");
    const first = commit(
      dest,
      { ...vendored, "verify.yaml": policyYaml("enforce"), "package.json": manifest(BASE_DEPS), "package-lock.json": lock(BASE_DEPS, BASE_PKGS), ".gitagent/foreman/PLANNER.signing.pub": signersFor(PLANNER) },
      "the baseline",
    );
    const digests = approve(dest, first);
    git(dest, "reset", "-q", "--hard", first);
    const base = commit(dest, { ...files, ".gitagent/dependency-approvals/x.json": approvalText({ head, files: digests.map((d) => ({ path: "vendor/x", content_digest: d })) }) }, "depend on vendor/x");
    return { dest, base };
  };
  const digestAfter = (dest: string, change: Record<string, string>) => contentDigestAt(dest, commit(dest, change, "scratch"), "vendor/x")!;

  const { dest, base } = setup((d, first) => [contentDigestAt(d, first, "vendor/x")!]);
  commit(dest, { "src/app.ts": "x\n" }, "unrelated");
  assert.equal(run(dest, base).dependencies!.outcome, "pass", "the folder at base is approved");
  assert.deepEqual(run(dest, base).dependencies!.lockfiles, [], "and an unrelated change judges no lockfile");

  commit(dest, edited, "edit only the folder's code");
  const r = run(dest, base);
  assert.equal(r.status, "fail");
  assert.deepEqual(r.dependencies!.files, [], "no dependency file changed");
  assert.deepEqual(r.dependencies!.lockfiles.map((l) => [l.path, l.outcome]), [["package-lock.json", "hold"]]);
  assert.deepEqual(r.dependencies!.reasons.map((x) => [x.code, x.severity, x.location]), [
    ["local_folder_changed", "info", "vendor/x"],
    ["source_file", "hold", "vendor/x"],
  ]);

  const s = setup((d, first) => [contentDigestAt(d, first, "vendor/x")!]);
  commit(s.dest, scripted, "give the folder an install script");
  assert.deepEqual(codes(run(s.dest, s.base)).sort(), ["local_folder_changed", "manifest_without_lock_change", "source_file"]);

  const approved = setup((d) => [digestAfter(d, edited)]);
  commit(approved.dest, edited, "the edit the Planner approved at base");
  const ok = run(approved.dest, approved.base);
  assert.equal(ok.status, "pass", ok.problems.join("\n"));
  assert.deepEqual(codes(ok), ["local_folder_changed"]);
  assert.equal(ok.dependencies!.approvals_used.length, 1);

  const loose = setup((d) => [digestAfter(d, edited)]);
  write(loose.dest, edited);
  assert.deepEqual(codes(run(loose.dest, loose.base, { mode: "worktree" })), ["local_folder_changed", "source_file"], "worktree mode never digests an edited folder");
});

test("verify --contract: editing a workspace a base glob covers judges nothing (workspaces need no approval) (MSN-0383 review)", () => {
  const wsManifest = `${JSON.stringify({ name: "app", version: "1.0.0", workspaces: ["packages/*"], dependencies: BASE_DEPS }, null, 2)}\n`;
  const wsLock = `${JSON.stringify(
    {
      name: "app",
      version: "1.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: { "": { name: "app", version: "1.0.0", workspaces: ["packages/*"], dependencies: BASE_DEPS }, ...BASE_PKGS, "node_modules/w": { resolved: "packages/w", link: true }, "packages/w": { name: "w", version: "1.0.0" } },
    },
    null,
    2,
  )}\n`;
  assert.ok(graph(wsLock, wsManifest).nodes.some((n) => n.location === "packages/w" && n.source.kind === "workspace"));
  const { dest, base } = repo("enforce", { "package.json": wsManifest, "package-lock.json": wsLock, "packages/w/package.json": '{"name":"w","version":"1.0.0"}\n', "packages/w/index.js": "1\n" });
  commit(dest, { "packages/w/index.js": "2\n" }, "edit the workspace");
  const r = run(dest, base);
  assert.equal(r.status, "pass", r.problems.join("\n"));
  assert.deepEqual([r.dependencies!.files, r.dependencies!.lockfiles, r.dependencies!.reasons], [[], [], []]);
});

// --- MSN-0388: symlinks and unparseable head graphs (retrospective review of PR #368) -------------------------

/** Create (or replace) a symlink in the working tree; `commit` then records it as git mode 120000. */
function symlink(dest: string, rel: string, target: string): void {
  const abs = path.join(dest, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.rmSync(abs, { force: true });
  fs.symlinkSync(target, abs);
}

const FOLDER_DEPS = { a: "^1.0.0", x: "file:vendor/x" };
const FOLDER_PKGS: Packages = { ...BASE_PKGS, "node_modules/x": { resolved: "vendor/x", link: true }, "vendor/x": { name: "x", version: "1.0.0" } };
const FOLDER_FILES = { "package.json": manifest(FOLDER_DEPS), "package-lock.json": lock(FOLDER_DEPS, FOLDER_PKGS) };
const FOLDER_GRAPH = graph(FOLDER_FILES["package-lock.json"], FOLDER_FILES["package.json"]);

/**
 * Base: `vendor/x` (regular files in `files`, symlinks in `links`), the lockfile depending on it and an approval for
 * the folder's content digest at the first commit. Where the fixed code gives the folder no digest, the approval names
 * a digest nothing matches, standing in for one made by a reader that hashed the link text.
 */
function folderRepo(files: Record<string, string>, links: Record<string, string> = {}, verifyYaml = policyYaml("enforce")) {
  const dest = tmp("og-verify-depadm-link-");
  git(dest, "init", "-q", "-b", "main");
  for (const [rel, target] of Object.entries(links)) symlink(dest, rel, target);
  const first = commit(
    dest,
    { ...files, "verify.yaml": verifyYaml, "package.json": manifest(BASE_DEPS), "package-lock.json": lock(BASE_DEPS, BASE_PKGS), ".gitagent/foreman/PLANNER.signing.pub": signersFor(PLANNER) },
    "the baseline",
  );
  const digest = contentDigestAt(dest, first, "vendor/x") ?? "0".repeat(64);
  const base = commit(dest, { ...FOLDER_FILES, ".gitagent/dependency-approvals/x.json": approvalText({ head: FOLDER_GRAPH, files: [{ path: "vendor/x", content_digest: digest }] }) }, "depend on vendor/x");
  return { dest, base, first };
}

test("contentDigestAt: a folder that holds a symlink, or is one, has no digest, so no approval can match it (MSN-0388)", () => {
  const { dest, first } = folderRepo({ "vendor/x/package.json": '{"name":"x","version":"1.0.0"}\n', "lib/impl.js": "1\n", "vendor/y/index.js": "1\n" }, { "vendor/x/index.js": "../../lib/impl.js", "vendor/z": "y" });
  assert.equal(contentDigestAt(dest, first, "vendor/x"), null, "a folder with a symlink in it");
  assert.equal(contentDigestAt(dest, first, "vendor/z"), null, "a path that is itself a symlink");
  assert.match(contentDigestAt(dest, first, "vendor/y") ?? "", /^[0-9a-f]{64}$/, "a folder of regular files keeps its digest");
});

test("verify --contract: editing the target of a symlink inside an approved file: folder holds (MSN-0388)", () => {
  const { dest, base } = folderRepo({ "vendor/x/package.json": '{"name":"x","version":"1.0.0"}\n', "lib/impl.js": "module.exports = 1;\n" }, { "vendor/x/index.js": "../../lib/impl.js" });
  commit(dest, { "lib/impl.js": "module.exports = evil();\n" }, "edit only the link target");
  const r = run(dest, base);
  assert.equal(r.status, "fail", "a hold under enforce fails the run");
  assert.equal(r.dependencies!.outcome, "hold");
  assert.deepEqual(r.dependencies!.lockfiles.map((l) => [l.path, l.outcome]), [["package-lock.json", "hold"]]);
  assert.ok(codes(r).includes("source_file"), codes(r).join());
  assert.ok(r.dependencies!.reasons.some((x) => x.code === "local_folder_changed" && x.location === "vendor/x" && /symlink/.test(x.detail)));
});

test("verify --contract: a file: folder's package.json that is a symlink holds when its target gains an install script (MSN-0388)", () => {
  const { dest, base } = folderRepo({ "vendor/x/index.js": "module.exports = 1;\n", "lib/x.package.json": '{"name":"x","version":"1.0.0"}\n' }, { "vendor/x/package.json": "../../lib/x.package.json" });
  commit(dest, { "lib/x.package.json": '{"name":"x","version":"1.0.0","scripts":{"install":"node evil.js"}}\n' }, "install script through the link");
  const r = run(dest, base);
  assert.equal(r.status, "fail");
  assert.ok(r.dependencies!.reasons.some((x) => x.code === "dependency_file_symlink" && x.severity === "hold" && x.file === "vendor/x/package.json"), codes(r).join());
  assert.ok(codes(r).includes("source_file"), codes(r).join());
});

test("verify --contract: a symlinked lockfile holds and is judged when only its target changes, committed or in the worktree (MSN-0388)", () => {
  const dest = tmp("og-verify-depadm-locklink-");
  git(dest, "init", "-q", "-b", "main");
  symlink(dest, "package-lock.json", "deps/lock.json");
  const base = commit(
    dest,
    { "verify.yaml": policyYaml("enforce"), "package.json": manifest(BASE_DEPS), "deps/lock.json": lock(BASE_DEPS, BASE_PKGS), ".gitagent/foreman/PLANNER.signing.pub": signersFor(PLANNER) },
    "base with a symlinked lockfile",
  );
  const evil = { "deps/lock.json": lock({ a: "^1.0.0", evil: "^1.0.0" }, { ...BASE_PKGS, "node_modules/evil": reg("evil", "1.0.0", { hasInstallScript: true }) }) };
  write(dest, evil);
  const wt = run(dest, base, { mode: "worktree" });
  assert.equal(wt.status, "fail", "worktree mode");
  assert.ok(wt.dependencies!.reasons.some((x) => x.code === "dependency_file_symlink" && x.file === "package-lock.json"), codes(wt).join());
  commit(dest, evil, "add a scripted package through the link target");
  const r = run(dest, base);
  assert.equal(r.status, "fail");
  assert.ok(r.dependencies!.reasons.some((x) => x.code === "dependency_file_symlink" && x.severity === "hold" && x.file === "package-lock.json"), codes(r).join());
  assert.deepEqual(r.dependencies!.lockfiles.map((l) => [l.path, l.outcome]), [["package-lock.json", "hold"]], "the lockfile is judged, not skipped");
});

test("verify --contract: a dependency file that is a symlink only at base, or only at head, holds (MSN-0388)", () => {
  const atBase = tmp("og-verify-depadm-npmrclink-");
  git(atBase, "init", "-q", "-b", "main");
  symlink(atBase, "tools/package.json", "../package.json");
  const base = commit(atBase, { "verify.yaml": policyYaml("enforce"), "package.json": manifest(BASE_DEPS), "package-lock.json": lock(BASE_DEPS, BASE_PKGS), ".gitagent/foreman/PLANNER.signing.pub": signersFor(PLANNER) }, "base");
  fs.rmSync(path.join(atBase, "tools"), { recursive: true });
  commit(atBase, { "src/app.ts": "1\n" }, "remove the link");
  assert.ok(run(atBase, base).dependencies!.reasons.some((x) => x.code === "dependency_file_symlink" && x.file === "tools/package.json"), "a symlink at base");

  const { dest, base: b2 } = repo("enforce");
  symlink(dest, "pkgs/w/.npmrc", "../../notes.txt");
  commit(dest, { "notes.txt": "registry=https://evil.example/\n" }, "add a symlinked .npmrc");
  const r = run(dest, b2);
  assert.equal(r.status, "fail");
  assert.ok(r.dependencies!.reasons.some((x) => x.code === "dependency_file_symlink" && x.file === "pkgs/w/.npmrc"), codes(r).join());
});

test("verify --contract: a task contract that only tightens limits cannot turn an edited-folder hold into a pass (MSN-0388)", () => {
  const { dest, base } = folderRepo({ "vendor/x/package.json": '{"name":"x","version":"1.0.0"}\n', "vendor/x/index.js": "module.exports = 1;\n" });
  commit(dest, { "vendor/x/index.js": "module.exports = evil();\n" }, "edit the folder");
  assert.equal(run(dest, base).status, "fail", "with the repository contract alone it holds");
  const task = path.join(tmp("og-verify-depadm-task-"), "task.yaml");
  fs.writeFileSync(task, policyYaml("enforce", null).replace("  lifecycle:\n", "  limits:\n    max_nodes: 1\n  lifecycle:\n"));
  const r = run(dest, base, { contract: task });
  assert.deepEqual(r.problems.filter((p) => /contract/i.test(p) && !/dependencies:/.test(p)), [], "the task contract is a legal tightening");
  assert.equal(r.status, "fail", r.problems.join("\n"));
  assert.deepEqual(r.dependencies!.lockfiles.map((l) => [l.path, l.outcome]), [["package-lock.json", "hold"]]);
  assert.ok(codes(r).includes("graph_hold"), codes(r).join());
});

test("verify --contract: an unchanged lockfile whose head graph does not parse is judged (graph_hold) when anything changed (MSN-0388)", () => {
  const unknown = lock(BASE_DEPS, BASE_PKGS).replace('"requires": true,', '"requires": true,\n  "futureField": 1,');
  assert.notEqual(parseNpmLockfile(unknown, { manifest: manifest(BASE_DEPS) }).status, "ok", "the fixture has a field the parser refuses");
  const { dest, base } = repo("enforce", { "package-lock.json": unknown });
  commit(dest, { "src/app.ts": "1\n" }, "an unrelated change");
  const r = run(dest, base);
  assert.equal(r.status, "fail");
  assert.deepEqual(r.dependencies!.files, [], "no dependency file changed");
  assert.deepEqual(r.dependencies!.lockfiles.map((l) => [l.path, l.outcome]), [["package-lock.json", "hold"]]);
  assert.ok(codes(r).includes("graph_hold"), codes(r).join());
});

// --- MSN-0388 review round: listings fail closed, submodules, worktree and head-only symlinks -------------------

const LINK_FILES = { "vendor/x/package.json": '{"name":"x","version":"1.0.0"}\n', "lib/impl.js": "module.exports = 1;\n" };
const LINK_LINKS = { "vendor/x/index.js": "../../lib/impl.js" };
const EVIL_IMPL = { "lib/impl.js": "module.exports = evil();\n" };

/** Call the reader directly, as `verify --contract` does, so a test can lower the listing buffer. */
function judge(dest: string, base: string, worktree: boolean, listMaxBytes?: number) {
  const head = git(dest, "rev-parse", "HEAD");
  const changed = (worktree ? git(dest, "diff", "--name-only", base) : git(dest, "diff", "--name-only", base, head)).split("\n").filter(Boolean);
  return judgeDependencies({ root: dest, base, head, worktree, changed, policy: policyOf("enforce"), now: NOW, ...(listMaxBytes === undefined ? {} : { listMaxBytes }) });
}

test("verify --contract: a tree listing that fails or outgrows its buffer is an error, never an empty list that passes (MSN-0388 review)", () => {
  const filler = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`fill/f${String(i).padStart(4, "0")}.txt`, "x\n"]));
  for (const worktree of [false, true]) {
    const { dest, base } = folderRepo({ ...LINK_FILES, ...filler }, LINK_LINKS);
    if (worktree) write(dest, EVIL_IMPL);
    else commit(dest, EVIL_IMPL, "edit only the link target");
    assert.equal(judge(dest, base, worktree).outcome, "hold", `the default buffer judges the folder (worktree=${String(worktree)})`);
    assert.throws(
      () => judge(dest, base, worktree, 4096),
      (e: unknown) => (e as { code?: string }).code === "GXT_VERIFY_GIT_FAILED",
      `a listing over the buffer must not read as "no symlinks" (worktree=${String(worktree)})`,
    );
  }
});

/** Point `path` at a submodule commit in the index and commit it (no checkout: the gitlink is all git records). */
function commitGitlink(dest: string, rel: string, oid: string, message: string): string {
  git(dest, "update-index", "--add", "--cacheinfo", `160000,${oid},${rel}`);
  git(dest, "commit", "-q", "-m", message);
  return git(dest, "rev-parse", "HEAD");
}

test("verify --contract: a submodule bump above a file: folder judges the lockfile and holds (MSN-0388 review)", () => {
  const dest = tmp("og-verify-depadm-gitlink-");
  git(dest, "init", "-q", "-b", "main");
  commit(dest, { "verify.yaml": policyYaml("enforce"), ...FOLDER_FILES, ".gitagent/foreman/PLANNER.signing.pub": signersFor(PLANNER) }, "depend on vendor/x");
  const base = commitGitlink(dest, "vendor", "1".repeat(40), "vendor is a submodule");
  commitGitlink(dest, "vendor", "2".repeat(40), "bump the submodule only");
  const r = run(dest, base);
  assert.equal(r.status, "fail", "a hold under enforce fails the run");
  assert.deepEqual(r.dependencies!.files, [], "no dependency file changed");
  assert.deepEqual(r.dependencies!.lockfiles.map((l) => [l.path, l.outcome]), [["package-lock.json", "hold"]], "the lockfile is judged");
  assert.ok(codes(r).includes("source_file"), codes(r).join());
  assert.ok(r.dependencies!.reasons.some((x) => x.code === "local_folder_changed" && x.location === "vendor/x" && /submodule/.test(x.detail)), codes(r).join());
});

test("verify --contract: a submodule added inside an approved file: folder holds (MSN-0388 review)", () => {
  const { dest, base } = folderRepo({ "vendor/x/package.json": '{"name":"x","version":"1.0.0"}\n', "vendor/x/index.js": "module.exports = 1;\n" });
  assert.equal(run(dest, base).dependencies!.outcome, "pass", "the folder at base is approved");
  commitGitlink(dest, "vendor/x/sub", "3".repeat(40), "a submodule inside the folder");
  const r = run(dest, base);
  assert.equal(r.status, "fail");
  assert.ok(codes(r).includes("source_file"), codes(r).join());
  assert.ok(r.dependencies!.reasons.some((x) => x.code === "local_folder_changed" && /submodule/.test(x.detail)), codes(r).join());
});

test("verify --contract: editing a symlink's target outside an approved file: folder holds in worktree mode too (MSN-0388 review)", () => {
  const { dest, base } = folderRepo(LINK_FILES, LINK_LINKS);
  write(dest, EVIL_IMPL);
  const r = run(dest, base, { mode: "worktree" });
  assert.equal(r.status, "fail");
  assert.deepEqual(r.dependencies!.lockfiles.map((l) => [l.path, l.outcome]), [["package-lock.json", "hold"]]);
  assert.ok(codes(r).includes("source_file"), codes(r).join());
  assert.ok(r.dependencies!.reasons.some((x) => x.code === "local_folder_changed" && /symlink/.test(x.detail)), codes(r).join());
});

test("verify --contract: a symlink added only at head inside an approved file: folder holds (MSN-0388 review)", () => {
  const { dest, base } = folderRepo({ "vendor/x/package.json": '{"name":"x","version":"1.0.0"}\n', "vendor/x/index.js": "module.exports = 1;\n", "lib/impl.js": "module.exports = 1;\n" });
  assert.equal(run(dest, base).dependencies!.outcome, "pass", "the folder at base is approved");
  symlink(dest, "vendor/x/extra.js", "../../lib/impl.js");
  commit(dest, {}, "a symlink into the folder");
  const r = run(dest, base);
  assert.equal(r.status, "fail");
  assert.ok(codes(r).includes("source_file"), codes(r).join());
  assert.ok(r.dependencies!.reasons.some((x) => x.code === "local_folder_changed" && /symlink/.test(x.detail)), codes(r).join());
});

test("gantry verify --help: --out names both result schemas and when each is written (MSN-0388)", () => {
  const r = spawnSync(process.execPath, [CLI, "verify", "--help"], { encoding: "utf8", env: gitChildEnv() });
  const help = r.stdout.replace(/\s+/g, " ");
  const out = help.slice(help.indexOf("--out <file>"), help.indexOf("--criticality-record"));
  assert.match(out, /opengantry\.verify-result\.v1/, out);
  assert.match(out, /opengantry\.verify-result\.v2/, out);
  assert.match(out, /dependencies/, "says when v2 is written");
});

test("verify --check-result: a v2 result binds its dependency section; malformed and stripped sections are refused (MSN-0383, DEP06)", () => {
  const { dest, base } = repo("audit");
  commit(dest, ADD_B, "add b");
  const r = run(dest, base);
  const out = path.join(tmp("og-verify-depadm-out-"), "result.json");
  const save = (v: unknown) => fs.writeFileSync(out, `${JSON.stringify(v, null, 2)}\n`);
  const check = () => checkVerifyResult(out, { cwd: dest, base });

  save(r);
  assert.deepEqual(check().problems, []);

  // The released 4.0.3 reader refusing this shape is proven against the published package in its own test below.

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

/** The files of an npm tarball (ustar, as `npm pack` writes it), written under `dest`; refuses links and `..`. */
function untar(tgz: Buffer, dest: string): void {
  const tar = gunzipSync(tgz);
  for (let at = 0; at + 512 <= tar.length; ) {
    const header = tar.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const field = (from: number, len: number) => header.subarray(from, from + len).toString("utf8").replace(/\0.*$/s, "");
    const name = [field(345, 155), field(0, 100)].filter(Boolean).join("/");
    const size = parseInt(field(124, 12).trim() || "0", 8);
    const type = field(156, 1) || "0";
    assert.ok(!name.split("/").includes("..") && !name.startsWith("/"), `tar entry ${name}`);
    if (type === "0") {
      fs.mkdirSync(path.dirname(path.join(dest, name)), { recursive: true });
      fs.writeFileSync(path.join(dest, name), tar.subarray(at + 512, at + 512 + size));
    } else assert.ok(type === "5" || type === "x" || type === "g", `tar entry ${name} has type ${type}`);
    at += 512 + Math.ceil(size / 512) * 512;
  }
}

const RELEASED_VERIFY_TGZ = path.join(getRepoRoot(), "src", "cli", "tests", "fixtures", "opengantry-verify-4.0.3.tgz");
/** `npm view @jeger-ai/opengantry-verify@4.0.3 dist.integrity`: the fixture is the published tarball, byte for byte. */
const RELEASED_VERIFY_INTEGRITY = "sha512-ioMl0VIqUHIUAgOLkc3dd9B8PHPsD9jX6nI0JOO0BGODApeFrdDTNPIezCiBgunr3IXD/adt6WpmVv5MnK3xHg==";

test("the released 4.0.3 reader (the published @jeger-ai/opengantry-verify tarball) refuses a v2 result instead of ignoring the section (MSN-0383, DEP06)", async () => {
  const tgz = fs.readFileSync(RELEASED_VERIFY_TGZ);
  assert.equal(`sha512-${createHash("sha512").update(tgz).digest("base64")}`, RELEASED_VERIFY_INTEGRITY, "the fixture is the published 4.0.3 package");
  const pkgDir = tmp("og-verify-depadm-released-");
  untar(tgz, pkgDir);
  assert.equal((JSON.parse(fs.readFileSync(path.join(pkgDir, "package", "package.json"), "utf8")) as { version: string }).version, "4.0.3");
  const released = (await import(pathToFileURL(path.join(pkgDir, "package", "dist", "index.js")).href)) as {
    VERIFY_RESULT_SCHEMA: string;
    checkVerifyResult: (file: string, opts: { cwd: string; base: string; contract?: string }) => { ok: boolean; problems: string[] };
  };
  assert.equal(released.VERIFY_RESULT_SCHEMA, "opengantry.verify-result.v1");

  const { dest, base } = repo("audit");
  commit(dest, ADD_B, "add b");
  const r = run(dest, base);
  assert.equal(r.status, "pass");
  assert.equal(r.schema, "opengantry.verify-result.v2");
  const out = path.join(tmp("og-verify-depadm-released-out-"), "result.json");
  fs.writeFileSync(out, `${JSON.stringify(r, null, 2)}\n`);

  // With the repository contract the released reader already refuses the dependencies section of verify.yaml.
  assert.throws(() => released.checkVerifyResult(out, { cwd: dest, base }), /unknown key "dependencies"/);

  // Without a policy, the released reader accepts the v1 result of today's verify, and refuses the same result
  // turned into v2 with the section: its schema check rejects it, so the verdict is never silently ignored.
  const plain = tmp("og-verify-depadm-released-plain-");
  git(plain, "init", "-q", "-b", "main");
  const plainBase = commit(plain, { "verify.yaml": "schema: opengantry.verify.v1\n" }, "base");
  commit(plain, ADD_B, "add b");
  const v1 = run(plain, plainBase);
  assert.equal(v1.schema, "opengantry.verify-result.v1");
  fs.writeFileSync(out, `${JSON.stringify(v1, null, 2)}\n`);
  assert.deepEqual(released.checkVerifyResult(out, { cwd: plain, base: plainBase }).problems, [], "the released reader accepts what it knows");
  fs.writeFileSync(out, `${JSON.stringify({ ...v1, schema: r.schema, dependencies: { ...r.dependencies!, base: v1.base, head: v1.head } }, null, 2)}\n`);
  const checked = released.checkVerifyResult(out, { cwd: plain, base: plainBase });
  assert.equal(checked.ok, false);
  assert.deepEqual(checked.problems, ["not a opengantry.verify-result.v1 result"]);
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
