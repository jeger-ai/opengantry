import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { runCageCheck } from "#cage/cage-check.js";
import { APPROVAL_SIGNATURE_NAMESPACE, approvalSignedMessage, parseDependencyApproval, sshSignatureSignedData } from "#core/dependency-approval.js";
import { parseNpmLockfile, type NpmGraph } from "#core/dependency-graph.js";
import { dependencyPolicyRevision } from "#core/dependency-policy.js";
import { gitChildEnv, setGitSpawnForTests } from "#git/git.js";
import { checkMsnRange } from "#missions/ci-checks.js";
import { loadManifest } from "#missions/manifest.js";
import { discoverChangedMissions } from "#missions/mission-changed.js";
import { discoverChangedMissionFiles } from "#missions/mission-verify/engine.js";
import { evaluateTrustedAutomationCommit } from "#missions/trusted-automation.js";
import { verifyLedgerChain } from "#plane/ledger-chain.js";
import { parseVerifyYaml } from "#verify/contract.js";
import { runVerifyContract, type VerifyContractResult } from "#verify/run.js";
import { runVerifyCheck } from "#verify/checks.js";
import { writeManifest } from "./test-fixtures.js";
import { appendLedgerFixture } from "./test-org-fixtures.js";

/**
 * MSN-0389 (issues #355/#356): a git read that fails, or comes back cut short, never counts as success or as
 * "nothing there". spawnSync reports `status: 0` with truncated stdout when git exits before Node notices the
 * buffer overflow; only its `error` (ENOBUFS) shows it. The seam below makes git reads fail that way on demand.
 */

// --- the fault seam -------------------------------------------------------------------------------------------

type Out = string | Buffer;
const asBuffer = (o: Out | null | undefined): Buffer => (o == null ? Buffer.alloc(0) : typeof o === "string" ? Buffer.from(o) : o);
const like = (o: Out | null | undefined, b: Buffer): Out => (typeof o === "string" ? b.toString("utf8") : b);

/**
 * Real git, except for calls `match` selects: "truncate" keeps `keep(stdout)` and reports status 0 with ENOBUFS
 * (what Node reports when git exits before the overflow is noticed); "fail" reports exit 128 with no stdout.
 */
function inject(match: (args: string[]) => boolean, fault: "truncate" | "fail", keep: (out: Buffer) => Buffer = (b) => b.subarray(0, 16)): void {
  setGitSpawnForTests((command: string, args: string[], options: SpawnSyncOptions) => {
    const r = spawnSync(command, args, options);
    if (!match(args)) return r;
    if (fault === "fail") return { ...r, stdout: like(r.stdout, Buffer.alloc(0)), stderr: like(r.stderr, Buffer.from("fatal: injected failure (MSN-0389 test)\n")), status: 128, signal: null };
    const error = Object.assign(new Error(`spawnSync ${command} ENOBUFS`), { code: "ENOBUFS" });
    return { ...r, stdout: like(r.stdout, keep(asBuffer(r.stdout))), status: 0, signal: null, error };
  });
}
test.afterEach(() => setGitSpawnForTests(null));

const has = (...parts: string[]) => (args: string[]) => parts.every((p) => args.some((a) => a === p || a.includes(p)));

// --- repositories ---------------------------------------------------------------------------------------------

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

function commit(dest: string, files: Record<string, string>, message: string, author = "fixture@example.com"): string {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
    fs.writeFileSync(path.join(dest, rel), text);
  }
  git(dest, "add", "-A");
  git(dest, "-c", `user.email=${author}`, "commit", "-q", "--allow-empty", "-m", message);
  return git(dest, "rev-parse", "HEAD");
}

function newRepo(prefix: string, files: Record<string, string>): { dest: string; base: string } {
  const dest = tmp(prefix);
  git(dest, "init", "-q", "-b", "main");
  return { dest, base: commit(dest, files, "base") };
}

const gitFailed = (code: string) => (err: unknown) => (err as { code?: string }).code === code;
const mentionsGit = (err: unknown) => /git .*failed|injected failure|ENOBUFS/.test((err as Error).message);

// --- dependency approvals (verify --contract) -------------------------------------------------------------------

const REG = "https://registry.npmjs.org/";
const reg = (name: string, version: string) => ({ version, resolved: `${REG}${name}/-/${name}-${version}.tgz`, integrity: `sha512-${name}-${version}` });
const lock = (deps: Record<string, string>, pkgs: Record<string, unknown>) =>
  `${JSON.stringify({ name: "app", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "app", version: "1.0.0", dependencies: deps }, ...pkgs } }, null, 2)}\n`;
const manifest = (deps: Record<string, string>) => `${JSON.stringify({ name: "app", version: "1.0.0", dependencies: deps }, null, 2)}\n`;
const BASE = { deps: { a: "^1.0.0" }, pkgs: { "node_modules/a": reg("a", "1.0.0") } };
const ADDED = { deps: { a: "^1.0.0", b: "^1.0.0" }, pkgs: { "node_modules/a": reg("a", "1.0.0"), "node_modules/b": reg("b", "1.0.0") } };
const BASE_GRAPH = (): NpmGraph => graph(lock(BASE.deps, BASE.pkgs), manifest(BASE.deps));
const policy = (): string => [
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
  `  approved_baseline_digest: "${BASE_GRAPH().digest}"`,
  "  lifecycle:",
  "    default: deny",
  "",
].join("\n");

function sshString(b: Buffer | string): Buffer {
  const body = typeof b === "string" ? Buffer.from(b) : b;
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  return Buffer.concat([len, body]);
}
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const KEY: { priv: KeyObject; blob: Buffer } = {
  priv: privateKey,
  blob: Buffer.concat([sshString("ssh-ed25519"), sshString(Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url"))]),
};
function sshsig(message: string): string {
  const sig = sign(null, sshSignatureSignedData(message, APPROVAL_SIGNATURE_NAMESPACE, "sha512"), KEY.priv);
  const blob = Buffer.concat([
    Buffer.from("SSHSIG"),
    Buffer.from([0, 0, 0, 1]),
    sshString(KEY.blob),
    sshString(APPROVAL_SIGNATURE_NAMESPACE),
    sshString(""),
    sshString("sha512"),
    sshString(Buffer.concat([sshString("ssh-ed25519"), sshString(sig)])),
  ]);
  return `-----BEGIN SSH SIGNATURE-----\n${blob.toString("base64")}\n-----END SSH SIGNATURE-----\n`;
}

function graph(lockText: string, manifestText: string): NpmGraph {
  const r = parseNpmLockfile(lockText, { manifest: manifestText });
  assert.equal(r.status, "ok");
  return (r as { graph: NpmGraph }).graph;
}

/** A signed approval of `b` in the added graph, and a revocation of that approval. */
function approvalAndRevocation(): { approval: string; revocation: string } {
  const head = graph(lock(ADDED.deps, ADDED.pkgs), manifest(ADDED.deps));
  const b = head.nodes.find((n) => n.location === "node_modules/b")!;
  const body = {
    schema: "opengantry.dependency-approval.v1",
    lockfile: "package-lock.json",
    graph_digest: head.digest,
    policy_revision: dependencyPolicyRevision(parseVerifyYaml(policy()).dependencies!),
    identities: [{ name: b.name, version: b.version, source: { kind: b.source.kind, ref: b.source.ref }, integrity: b.integrity }],
    lifecycle: [],
    root_scripts: [],
    files: [],
    approver: "planner@example.com",
    issued_at: "2026-11-16T00:00:00Z",
    expires_at: "2026-12-16T00:00:00Z",
  };
  const approval = `${JSON.stringify({ ...body, signature: sshsig(approvalSignedMessage(body)) }, null, 2)}\n`;
  const revocation = `${JSON.stringify({
    schema: "opengantry.dependency-revocation.v1",
    revokes: [parseDependencyApproval(approval).id],
    reason: "key compromise",
    revoked_by: "planner@example.com",
    issued_at: "2026-11-16T06:00:00Z",
  })}\n`;
  return { approval, revocation };
}

test("verify --contract: a truncated approvals listing that drops a revocation holds instead of admitting the revoked approval (MSN-0389)", () => {
  const { approval, revocation } = approvalAndRevocation();
  const { dest, base } = newRepo("og-trunc-approvals-", {
    "verify.yaml": policy(),
    "package.json": manifest(BASE.deps),
    "package-lock.json": lock(BASE.deps, BASE.pkgs),
    ".gitagent/foreman/PLANNER.signing.pub": `planner@example.com ssh-ed25519 ${KEY.blob.toString("base64")}\n`,
    ".gitagent/dependency-approvals/b.json": approval,
    ".gitagent/dependency-approvals/z-revoke-b.json": revocation,
  });
  commit(dest, { "package.json": manifest(ADDED.deps), "package-lock.json": lock(ADDED.deps, ADDED.pkgs) }, "add b");
  const run = (): VerifyContractResult => runVerifyContract({ cwd: dest, base, now: "2026-11-17T12:00:00Z" });

  const honest = run();
  assert.equal(honest.status, "fail", "the revocation is honoured when the listing is complete");
  assert.ok(honest.dependencies!.reasons.some((r) => r.code === "approval_revoked"));

  // The listing comes back with the approval only: the revocation, sorted after it, is cut off.
  inject(has("ls-tree", ".gitagent/dependency-approvals/"), "truncate", (out) => out.subarray(0, out.indexOf(0) + 1));
  let truncated: VerifyContractResult | null = null;
  try {
    truncated = run();
  } catch (err) {
    assert.ok(mentionsGit(err), String(err));
  }
  if (truncated) {
    assert.notEqual(truncated.status, "pass", "a revoked approval must not admit b");
    assert.notEqual(truncated.dependencies!.outcome, "pass");
    assert.deepEqual(truncated.dependencies!.approvals_used, []);
  }
});

// --- verify contract authority from the base ----------------------------------------------------------------------

const STRICT = ["schema: opengantry.verify.v1", "scope:", "  allowed_paths: [app]", "  forbidden_paths: [app/secret]", ""].join("\n");
const LOOSE = ["schema: opengantry.verify.v1", "scope:", "  allowed_paths: [app]", "  forbidden_paths: []", ""].join("\n");

test("verify --contract: a failed tracking check does not let a tracked contract be read from the change (MSN-0389)", () => {
  const { dest, base } = newRepo("og-trunc-tracked-", { "ci/strict.yaml": STRICT, "app/x.txt": "x\n" });
  commit(dest, { "ci/strict.yaml": LOOSE, "app/secret/key.txt": "k\n" }, "loosen the contract and touch the forbidden path");
  const run = () => runVerifyContract({ cwd: dest, base, contract: "ci/strict.yaml" });
  assert.equal(run().status, "fail", "the base contract forbids app/secret");

  inject(has("ls-files"), "fail");
  assert.throws(run, gitFailed("GXT_VERIFY_GIT_FAILED"));
});

test("verify --contract: a failed read of the base verify.yaml is an error, not a repository without law (MSN-0389)", () => {
  const { dest, base } = newRepo("og-trunc-repolaw-", { "verify.yaml": STRICT, "app/x.txt": "x\n" });
  commit(dest, { "app/secret/key.txt": "k\n" }, "touch the forbidden path");
  const outside = tmp("og-trunc-task-");
  fs.writeFileSync(path.join(outside, "gate.json"), JSON.stringify({ schema: "opengantry.gate.v1", base, allowed_paths: ["."], forbidden_paths: [], checks: [] }));
  const run = () => runVerifyContract({ cwd: dest, contract: path.join(outside, "gate.json") });
  assert.equal(run().status, "fail", "the base verify.yaml forbids app/secret under any task contract");

  inject(has(`${base}:verify.yaml`), "fail");
  assert.throws(run, gitFailed("GXT_VERIFY_GIT_FAILED"));
});

// --- cage check rules at base ------------------------------------------------------------------------------------

test("cage check: a failed read of the base manifest is an error, not a manifest without zones (MSN-0389)", () => {
  const dest = tmp("og-trunc-cage-");
  git(dest, "init", "-q", "-b", "main");
  writeManifest(dest, { app: { trust_threshold: "Tier-2", tmvc_roots: ["src/"], forbidden_zones: ["infra/"] } });
  const base = commit(dest, { "infra/main.tf": "# infra\n", "README.md": "r\n" }, "base");
  commit(dest, { "infra/main.tf": "# changed\n" }, "edit a forbidden zone");
  assert.equal(runCageCheck({ cwd: dest, base }).status, "violations");

  inject(has(".gitagent/foreman/MANIFEST.json"), "fail");
  assert.throws(() => runCageCheck({ cwd: dest, base }), gitFailed("GXT_CAGE_CHECK_RULES_INVALID"));
});

// --- CI checks, trusted automation, mission discovery -------------------------------------------------------------

function appRepo(prefix: string): { dest: string; base: string } {
  const dest = tmp(prefix);
  git(dest, "init", "-q", "-b", "main");
  writeManifest(dest, { app: { trust_threshold: "Tier-2", tmvc_roots: ["src/"], forbidden_zones: [] } });
  return { dest, base: commit(dest, { "src/a.ts": "export const a = 1;\n" }, "base") };
}

test("ci msn-range: a failed commit listing fails the check instead of finding no commits (MSN-0389)", () => {
  const { dest, base } = appRepo("og-trunc-msn-");
  const head = commit(dest, { "src/a.ts": "export const a = 2;\n" }, "feat: no mission");
  assert.equal(checkMsnRange(dest, loadManifest(dest), base, head).ok, false);

  inject(has("rev-list"), "fail");
  assert.throws(() => checkMsnRange(dest, loadManifest(dest), base, head), mentionsGit);
});

test("trusted automation: a failed numstat is an error, not zero changed lines (MSN-0389)", () => {
  const BOT = "223556219+Copilot@users.noreply.github.com";
  const { dest } = appRepo("og-trunc-ta-");
  const rules = { trusted_automation: { rules: [{ id: "autofix", allowed_actors: [BOT], allowed_paths: ["src/**"], allowed_structural_changes: ["bounded_content"], max_net_loc: 5 }] } };
  commit(dest, { ".gitagent/config.json": JSON.stringify(rules) }, "policy");
  const head = commit(dest, { "src/a.ts": `export const a = 2;\n${"// padding\n".repeat(30)}` }, "fix: oversized autofix", BOT);
  const honest = evaluateTrustedAutomationCommit(dest, loadManifest(dest), head);
  assert.equal(honest.eligible, false);
  assert.match(honest.reason, /net_loc/);

  inject(has("--numstat"), "fail");
  assert.throws(() => evaluateTrustedAutomationCommit(dest, loadManifest(dest), head), mentionsGit);
});

test("mission discovery: a failed diff or log is an error, not 'no missions changed' (MSN-0389)", () => {
  const { dest, base } = appRepo("og-trunc-missions-");
  commit(dest, { ".gitagent/missions/MSN-0001.x.yaml": "msn_id: MSN-0001\n" }, "[MSN-0001] legislate");
  assert.deepEqual(discoverChangedMissionFiles(dest, base), [".gitagent/missions/MSN-0001.x.yaml"]);

  inject(has("diff"), "fail");
  assert.throws(() => discoverChangedMissionFiles(dest, base), mentionsGit);
  setGitSpawnForTests(null);
  inject(has("log", "--no-merges"), "fail");
  assert.throws(() => discoverChangedMissions(dest, { baseRef: base, headRef: "HEAD" }), mentionsGit);
});

// --- ledger chain -------------------------------------------------------------------------------------------------

test("ledger chain: a failed commit listing is reported, not read as an empty valid chain (MSN-0389)", () => {
  const dest = tmp("og-trunc-ledger-");
  git(dest, "init", "-q", "-b", "main");
  // The ledger appends with git commit-tree, which reads the repository's own identity (CI has no global one).
  git(dest, "config", "user.email", "fixture@example.com");
  git(dest, "config", "user.name", "Fixture");
  commit(dest, { "README.md": "r\n" }, "init");
  appendLedgerFixture(dest, { msn_id: "MSN-0100" });
  appendLedgerFixture(dest, { msn_id: "MSN-0101" });
  assert.equal(verifyLedgerChain(dest).count, 2);

  inject(has("rev-list"), "truncate", () => Buffer.alloc(0));
  const r = verifyLedgerChain(dest);
  assert.equal(r.ok, false);
  assert.ok(r.errors.length > 0);
});

test("verify check: a run killed by a signal is never judged against the baseline (MSN-0389 review)", () => {
  const dest = tmp("og-trunc-signal-");
  const check = { name: "unit", run: "echo 'FAIL known-flake'; kill -9 $$", expect: "exit0" as const, heavy: false, quickRun: null, failures: "^FAIL (\\S+)" };
  const r = runVerifyCheck(dest, check, "full", { unit: ["known-flake"] });
  assert.equal(r.result.ok, false, r.result.reason);
  assert.match(r.result.reason, /killed by SIGKILL/);
});
