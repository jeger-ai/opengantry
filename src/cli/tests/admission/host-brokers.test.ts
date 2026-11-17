/**
 * The first typed host brokers (issue #356, owner decision Q7; ADM01, ADM04, ADM06, ADM-T04), offline: `git.publish`
 * pushes to a local bare repository, `delivery.mutate` talks to a fake GitHub API on 127.0.0.1. Every refusal happens
 * before an effect, an ambiguous outcome is `unknown` and is settled only by a read, and the token never appears in the
 * journal, a receipt, a response or an argv.
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildAdmissionRequest } from "#missions/admission/client.js";
import { GitHubActionsOidcCredentialProvider, GitHubAppCredentialProvider, HostCredentialError, SecretToken } from "#missions/admission/host-credentials.js";
import { canonicalRemoteUrl, branchMatches, hostConfigSchema } from "#missions/admission/host-config.js";
import { BrokerSetupError, loadHostBrokers, startBroker } from "#missions/admission/serve.js";
import { CONTRACT_DIGEST, journalTrail, openBroker, template } from "./fixtures.js";
import {
  CANONICAL_REMOTE,
  FakeGitHub,
  REPOSITORY,
  TestCredentialProvider,
  argvLog,
  everythingWritten,
  git,
  hostConfig,
  hostPolicy,
  hostRepo,
  openHostBroker,
  publishMessage,
  pullMessage,
  pushCount,
  remoteRef,
  testToken,
  type HostRepo,
} from "./host-fixtures.js";
import type { BrokerResponse } from "#missions/admission/broker.js";

function setup() {
  const repo = hostRepo();
  const policy = hostPolicy(path.join(repo.outside, "policy.json"));
  const token = testToken();
  const credentials = new TestCredentialProvider(token);
  const opened = openHostBroker(repo, policy, { credentials });
  return { repo, policy, token, credentials, ...opened };
}

async function withFake<T>(fn: (fake: FakeGitHub) => Promise<T>): Promise<T> {
  const fake = await new FakeGitHub().start();
  try {
    return await fn(fake);
  } finally {
    await fake.stop();
  }
}

// --- git.publish -------------------------------------------------------------------------------------------------

test("git.publish: pushes the exact commit to a new non-default branch, verified by reading the remote ref", async () => {
  const { repo, broker, journalFile, token } = setup();
  const res = await broker.handle(publishMessage(broker, { remote: "origin", branch: "feature/x", commit: repo.head }, null));
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.state, "confirmed");
  assert.equal(remoteRef(repo, "refs/heads/feature/x"), repo.head);
  assert.equal(remoteRef(repo, "refs/heads/main"), repo.base, "main is untouched");
  assert.equal(res.result?.observedHead, repo.head);
  assert.deepEqual(journalTrail(journalFile), ["decision:allow", "effect:dispatch-intent", "effect:confirmed"]);
  assert.equal(pushCount(repo), 1);
  const argv = argvLog(repo);
  assert.match(argv, /--force-with-lease=refs\/heads\/feature\/x: /, "a conditional push: the ref must be absent");
  assert.doesNotMatch(argv, /(^|\s)(--force|-f)(\s|$)/m, "never a plain force push");
  assert.doesNotMatch(argv, /\+[0-9a-f]{40}:/, "never a forced refspec");
  assert.equal(everythingWritten(journalFile, [res]).includes(token), false);
  assert.equal(argv.includes(token), false, "the token is never on an argv (what ps shows)");
});

test("git.publish: an update of an existing branch leases its expected old value", async () => {
  const { repo, broker } = setup();
  git(repo.root, ["push", "-q", repo.bare, `${repo.base}:refs/heads/topic`]);
  const res = await broker.handle(publishMessage(broker, { remote: "origin", branch: "topic", commit: repo.head }, repo.base));
  assert.equal(res.state, "confirmed", JSON.stringify(res));
  assert.equal(remoteRef(repo, "refs/heads/topic"), repo.head);
  assert.match(argvLog(repo), new RegExp(`--force-with-lease=refs/heads/topic:${repo.base}`));
});

test("git.publish: a push to the remote's default branch is refused and nothing is pushed", async () => {
  const { repo, broker, journalFile } = setup();
  const res = await broker.handle(publishMessage(broker, { remote: "origin", branch: "main", commit: repo.head }, repo.base));
  assert.equal(res.ok, false);
  assert.equal(res.refusal, "dispatch_check_failed", JSON.stringify(res));
  assert.match(res.detail ?? "", /default branch/);
  assert.equal(remoteRef(repo, "refs/heads/main"), repo.base);
  assert.equal(pushCount(repo), 0);
  assert.deepEqual(journalTrail(journalFile), ["decision:allow", "effect:expired"], "refused before any intent");
});

test("git.publish: a protected branch pattern from the host policy is denied before a permit exists", async () => {
  const { repo, broker, journalFile } = setup();
  const res = await broker.handle(publishMessage(broker, { remote: "origin", branch: "release/1.0", commit: repo.head }, null));
  assert.equal(res.state, "denied");
  assert.equal(res.refusal, "policy_denied");
  assert.deepEqual(res.decision?.policyRuleIds, ["broker-protected-branch"]);
  assert.equal(pushCount(repo), 0);
  assert.equal(remoteRef(repo, "refs/heads/release/1.0"), null);
  assert.deepEqual(journalTrail(journalFile), ["decision:deny"]);
});

test("git.publish: a stale expected old value is refused and nothing changes", async () => {
  const { repo, broker } = setup();
  git(repo.root, ["push", "-q", repo.bare, `${repo.base}:refs/heads/topic`]);
  const stale = "1".repeat(40);
  const res = await broker.handle(publishMessage(broker, { remote: "origin", branch: "topic", commit: repo.head }, stale));
  assert.equal(res.refusal, "dispatch_check_failed", JSON.stringify(res));
  assert.match(res.detail ?? "", /expected/);
  assert.equal(remoteRef(repo, "refs/heads/topic"), repo.base);
  assert.equal(pushCount(repo), 0);
  // An absent expectation on an existing ref is stale too.
  const res2 = await broker.handle(publishMessage(broker, { remote: "origin", branch: "topic", commit: repo.head }, null));
  assert.equal(res2.refusal, "dispatch_check_failed");
  assert.equal(remoteRef(repo, "refs/heads/topic"), repo.base);
});

test("git.publish: a concurrent update between the check and the push loses to the lease (ADM04 race boundary)", async () => {
  const { repo, broker } = setup();
  git(repo.root, ["push", "-q", repo.bare, `${repo.base}:refs/heads/topic`]);
  // Another writer moves the ref after the broker read it, just before the push (a commit the remote has: main's).
  fs.writeFileSync(path.join(repo.shimDir, "race"), `refs/heads/topic ${repo.base}`);
  const other = git(repo.root, ["commit-tree", "-p", repo.base, "-m", "other", `${repo.base}^{tree}`]);
  git(repo.root, ["push", "-q", repo.bare, `${other}:refs/heads/scratch`]);
  fs.writeFileSync(path.join(repo.shimDir, "race"), `refs/heads/topic ${other}`);
  const res = await broker.handle(publishMessage(broker, { remote: "origin", branch: "topic", commit: repo.head }, repo.base));
  assert.equal(res.ok, false);
  assert.equal(res.state, "failed", JSON.stringify(res));
  assert.match(res.detail ?? "", /\[rejected\] \(stale info\)/, "failed only on git's own porcelain refusal of the ref");
  assert.equal(remoteRef(repo, "refs/heads/topic"), other, "the other writer's value stands; the lease refused ours");
  assert.throws(() => git(repo.bare, ["cat-file", "-e", `${repo.head}^{commit}`]), "the lease refused before anything was sent: the commit never reached the remote");
});

test("git.publish: a lost acknowledgement (the remote took the push, the client saw an error) is unknown, never failed, even after the ref moved on", async () => {
  const { repo, broker } = setup();
  // The remote accepts the push, the connection drops before git hears so, and another writer moves the ref on (to a
  // commit the remote has) before the broker reads it back.
  const later = git(repo.root, ["commit-tree", "-p", repo.base, "-m", "later", `${repo.base}^{tree}`]);
  git(repo.root, ["push", "-q", repo.bare, `${later}:refs/heads/scratch`]);
  fs.writeFileSync(path.join(repo.shimDir, "lost-ack"), `refs/heads/feature/l ${later}`);
  const msg = publishMessage(broker, { remote: "origin", branch: "feature/l", commit: repo.head }, null);
  const { operationId, attemptId } = msg.request as { operationId: string; attemptId: string };
  const res = await broker.handle(msg);
  assert.equal(res.state, "unknown", JSON.stringify(res));
  assert.equal(pushCount(repo), 1);
  git(repo.bare, ["cat-file", "-e", `${repo.head}^{commit}`]);
  assert.equal(broker.prepare({ kind: "git.publish", operationId }).ok, false, "no new attempt while the push is unknown");
  // The ref holds neither the pushed commit nor the expected old value: reconciliation cannot tell yet.
  const early = await broker.handle({ type: "reconcile", request: msg.request, args: msg.args });
  assert.equal(early.refusal, "reconcile_inconclusive", JSON.stringify(early));
  assert.equal(broker.attemptState(operationId, attemptId), "unknown");
  // The later writer's update is rolled back: the ref holds our commit, and reconciliation confirms the push.
  git(repo.bare, ["update-ref", "refs/heads/feature/l", repo.head]);
  const rec = await broker.handle({ type: "reconcile", request: msg.request, args: msg.args });
  assert.equal(rec.state, "reconciled-confirmed", JSON.stringify(rec));
  assert.equal(pushCount(repo), 1, "settled by reading the ref, never a second push");
});

test("git.publish: a failed push without git's porcelain refusal is unknown even when the ref is unchanged; reconciliation settles it", async () => {
  const { repo, broker } = setup();
  fs.writeFileSync(path.join(repo.shimDir, "reject"), "error: failed to push some refs\n");
  const msg = publishMessage(broker, { remote: "origin", branch: "feature/e", commit: repo.head }, null);
  const res = await broker.handle(msg);
  assert.equal(res.state, "unknown", JSON.stringify(res));
  assert.equal(remoteRef(repo, "refs/heads/feature/e"), null);
  fs.rmSync(path.join(repo.shimDir, "reject"));
  const rec = await broker.handle({ type: "reconcile", request: msg.request, args: msg.args });
  assert.equal(rec.state, "reconciled-failed", JSON.stringify(rec));
  assert.equal(pushCount(repo), 1, "reconciliation pushed nothing");
});

test("git.publish: a remote that reports it refused the update (pre-receive) is failed", async () => {
  const { repo, broker } = setup();
  fs.writeFileSync(path.join(repo.shimDir, "reject"), `To ${repo.bare}\n!\t${repo.head}:refs/heads/feature/p\t[remote rejected] (pre-receive hook declined)\nDone\n`);
  const res = await broker.handle(publishMessage(broker, { remote: "origin", branch: "feature/p", commit: repo.head }, null));
  assert.equal(res.state, "failed", JSON.stringify(res));
  assert.match(res.detail ?? "", /\[remote rejected\] \(pre-receive hook declined\)/);
  assert.equal(remoteRef(repo, "refs/heads/feature/p"), null);
});

test("git.publish: the request binds the configured repository, the named remote and the arguments", async () => {
  const { repo, broker } = setup();
  const elsewhere = await broker.handle(publishMessage(broker, { remote: "origin", branch: "feature/y", commit: repo.head }, null, { remoteUrl: "https://github.com/other/repo" }));
  assert.equal(elsewhere.refusal, "policy_denied");
  assert.deepEqual(elsewhere.decision?.policyRuleIds, ["broker-host-repository"]);
  const swapped = await broker.handle(publishMessage(broker, { remote: "origin", branch: "feature/y", commit: repo.head }, null, { newHead: repo.base }));
  assert.equal(swapped.refusal, "request_changed");
  const tag = await broker.handle(publishMessage(broker, { remote: "origin", branch: "feature/y", commit: repo.head }, null, { ref: "refs/tags/v1" }));
  assert.equal(tag.refusal, "request_changed");
  git(repo.root, ["remote", "add", "fork", "https://github.com/someone/fork.git"]);
  const fork = await broker.handle(publishMessage(broker, { remote: "fork", branch: "feature/y", commit: repo.head }, null));
  assert.equal(fork.refusal, "dispatch_check_failed");
  assert.match(fork.detail ?? "", /fork/);
  const missing = await broker.handle(publishMessage(broker, { remote: "origin", branch: "feature/y", commit: "2".repeat(40) }, null));
  assert.equal(missing.refusal, "dispatch_check_failed");
  assert.equal(pushCount(repo), 0);
});

test("git.publish: the candidate's git config cannot redirect the push or run a hook", async () => {
  const { repo, broker } = setup();
  const marker = path.join(repo.outside, "hook-ran");
  fs.mkdirSync(path.join(repo.root, ".git", "hooks"), { recursive: true });
  fs.writeFileSync(path.join(repo.root, ".git", "hooks", "pre-push"), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
  git(repo.root, ["config", "url.https://evil.example/.insteadOf", "https://github.com/"]);
  const res = await broker.handle(publishMessage(broker, { remote: "origin", branch: "feature/z", commit: repo.head }, null));
  assert.equal(res.state, "confirmed", JSON.stringify(res));
  assert.equal(fs.existsSync(marker), false, "no candidate hook runs in the broker's push");
});

/** A repository outside the work tree (one the sandbox denies) holding a commit the candidate's own objects lack. */
function outsideRepo(): { gitDir: string; commit: string } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-host-other-")));
  git(dir, ["init", "-q", "--initial-branch=main"]);
  git(dir, ["config", "user.name", "Other"]);
  git(dir, ["config", "user.email", "other@example.invalid"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  git(dir, ["remote", "add", "origin", `${CANONICAL_REMOTE}.git`]);
  fs.writeFileSync(path.join(dir, "secret.txt"), `private ${crypto.randomBytes(8).toString("hex")}\n`);
  git(dir, ["add", "secret.txt"]);
  git(dir, ["commit", "-q", "-m", "private history"]);
  return { gitDir: path.join(dir, ".git"), commit: git(dir, ["rev-parse", "HEAD"]) };
}

test("git.publish: an alternates chain from the candidate's objects to another repository cannot export that repository's commits", async () => {
  const { repo, broker } = setup();
  const other = outsideRepo();
  fs.mkdirSync(path.join(repo.root, ".git", "objects", "info"), { recursive: true });
  fs.writeFileSync(path.join(repo.root, ".git", "objects", "info", "alternates"), `${path.join(other.gitDir, "objects")}\n`);
  assert.equal(git(repo.root, ["cat-file", "-t", other.commit]), "commit", "plain git in the candidate sees the outside commit through alternates");
  const res = await broker.handle(publishMessage(broker, { remote: "origin", branch: "feature/alt", commit: other.commit }, null));
  assert.equal(res.ok, false, JSON.stringify(res));
  assert.equal(res.refusal, "dispatch_check_failed");
  assert.equal(pushCount(repo), 0, "nothing was pushed");
  assert.equal(remoteRef(repo, "refs/heads/feature/alt"), null);
  // The candidate's own commits still push with the alternates file in place: it is skipped, not obeyed.
  const ok = await broker.handle(publishMessage(broker, { remote: "origin", branch: "feature/own", commit: repo.head }, null));
  assert.equal(ok.state, "confirmed", JSON.stringify(ok));
  assert.equal(remoteRef(repo, "refs/heads/feature/own"), repo.head);
});

test("git.publish: a commondir redirect or a symlinked object dir is refused and nothing is pushed", async () => {
  const { repo, broker } = setup();
  const other = outsideRepo();
  fs.writeFileSync(path.join(repo.root, ".git", "commondir"), `${other.gitDir}\n`);
  const res = await broker.handle(publishMessage(broker, { remote: "origin", branch: "feature/cd", commit: other.commit }, null));
  assert.equal(res.refusal, "dispatch_check_failed", JSON.stringify(res));
  assert.match(res.detail ?? "", /commondir/);
  assert.equal(pushCount(repo), 0);
  fs.rmSync(path.join(repo.root, ".git", "commondir"));
  const objects = path.join(repo.root, ".git", "objects");
  fs.renameSync(objects, `${objects}.real`);
  fs.symlinkSync(path.join(other.gitDir, "objects"), objects);
  const linked = await broker.handle(publishMessage(broker, { remote: "origin", branch: "feature/ln", commit: other.commit }, null));
  assert.equal(linked.refusal, "dispatch_check_failed", JSON.stringify(linked));
  assert.equal(pushCount(repo), 0);
  assert.equal(remoteRef(repo, "refs/heads/feature/ln"), null);
});

test("git.publish: a linked worktree's own commondir (its parent repository) is honoured and the commit pushes", async () => {
  const main = hostRepo();
  const linked = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-host-wt-"))), "wt");
  git(main.root, ["worktree", "add", "-q", "-b", "wt-branch", linked, main.head]);
  const repo = { ...main, root: linked };
  const policy = hostPolicy(path.join(main.outside, "policy.json"));
  const { broker } = openHostBroker(repo, policy, { credentials: new TestCredentialProvider(testToken()) });
  const res = await broker.handle(publishMessage(broker, { remote: "origin", branch: "feature/wt", commit: main.head }, null));
  assert.equal(res.state, "confirmed", JSON.stringify(res));
  assert.equal(remoteRef(main, "refs/heads/feature/wt"), main.head);
});

test("git.publish: the remote check reads the candidate's config without following includes", async () => {
  const { repo, broker } = setup();
  const included = path.join(repo.outside, "included.gitconfig");
  fs.writeFileSync(included, `[remote "inc"]\n\turl = ${CANONICAL_REMOTE}.git\n`);
  git(repo.root, ["config", "include.path", included]);
  assert.equal(git(repo.root, ["config", "--get", "remote.inc.url"]), `${CANONICAL_REMOTE}.git`, "git itself follows the include");
  const res = await broker.handle(publishMessage(broker, { remote: "inc", branch: "feature/inc", commit: repo.head }, null));
  assert.equal(res.refusal, "dispatch_check_failed", JSON.stringify(res));
  assert.match(res.detail ?? "", /no remote inc/);
  assert.equal(pushCount(repo), 0);
});

test("git.publish: the token reaches git as an http header, never as an argument", async () => {
  await withFake(async (fake) => {
    const repo = hostRepo();
    const policy = hostPolicy(path.join(repo.outside, "policy.json"));
    const token = testToken();
    git(repo.root, ["remote", "set-url", "origin", `${fake.baseUrl}/acme/widgets.git`]);
    const config = hostConfig({ gitBaseUrl: fake.baseUrl, apiBaseUrl: fake.baseUrl });
    const { broker, journalFile } = openHostBroker(repo, policy, { credentials: new TestCredentialProvider(token), config, git: { binary: repo.shim } });
    const res = await broker.handle(publishMessage(broker, { remote: "origin", branch: "feature/h", commit: repo.head }, null, { remoteUrl: "https://127.0.0.1/acme/widgets" }));
    assert.equal(res.refusal, "dispatch_check_failed", "the fake remote refuses; nothing was pushed");
    const expected = `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
    assert.ok(fake.gitAuthorizations.includes(expected), `the header reached the remote: ${JSON.stringify(fake.gitAuthorizations)}`);
    assert.equal(argvLog(repo).includes(token) || argvLog(repo).includes(expected), false);
    assert.equal(everythingWritten(journalFile, [res]).includes(token), false);
  });
});

test("git.publish: a crash between intent and outcome is unknown; reconciliation reads the remote and never pushes again", async () => {
  const { repo, policy, broker, credentials, token } = setup();
  fs.writeFileSync(path.join(repo.shimDir, "block"), "");
  const msg = publishMessage(broker, { remote: "origin", branch: "feature/c", commit: repo.head }, null);
  const { operationId, attemptId } = msg.request as { operationId: string; attemptId: string };
  const inflight = broker.handle(msg);
  const pidFile = path.join(repo.shimDir, "pid");
  for (let i = 0; i < 300 && !fs.existsSync(pidFile); i += 1) await new Promise((r) => setTimeout(r, 20));
  assert.ok(fs.existsSync(pidFile), "the push ran and the broker is stuck before its outcome");
  fs.rmSync(path.join(repo.shimDir, "block"));
  const second = openHostBroker(repo, policy, { credentials });
  assert.equal(second.broker.attemptState(operationId, attemptId), "unknown");
  assert.deepEqual(journalTrail(second.journalFile), ["decision:allow", "effect:dispatch-intent", "effect:unknown"]);
  const retry = second.broker.prepare({ kind: "git.publish", operationId });
  assert.equal(retry.ok, false, "an unknown operation gets no new attempt until reconciled");
  const tampered = await second.broker.handle({ type: "reconcile", request: { ...msg.request, attemptId: "at-000000000000000000000000" }, args: msg.args });
  assert.equal(tampered.ok, false);
  const rec = await second.broker.handle({ type: "reconcile", request: msg.request, args: msg.args });
  assert.equal(rec.ok, true, JSON.stringify(rec));
  assert.equal(rec.state, "reconciled-confirmed");
  assert.equal(second.broker.attemptState(operationId, attemptId), "reconciled-confirmed");
  assert.deepEqual(journalTrail(second.journalFile), ["decision:allow", "effect:dispatch-intent", "effect:unknown", "effect:reconciled-confirmed"]);
  const again = await second.broker.handle({ type: "reconcile", request: msg.request, args: msg.args });
  assert.equal(again.ok, false, "a settled attempt is not reconciled twice");
  assert.equal(pushCount(repo), 1, "exactly one push: reconciliation only read the remote");
  assert.equal(remoteRef(repo, "refs/heads/feature/c"), repo.head);
  process.kill(Number(fs.readFileSync(pidFile, "utf8").trim()), "SIGKILL");
  const late = await inflight;
  assert.notEqual(late.state, "confirmed", "the abandoned broker cannot journal over its successor");
  assert.equal(everythingWritten(second.journalFile, [rec, late]).includes(token), false);
});

test("git.publish: reconciliation of a push that never landed records reconciled-failed, and still pushes nothing", async () => {
  const { repo, policy, broker, credentials } = setup();
  // Block before the push itself: the shim hangs without pushing.
  const shim = fs.readFileSync(repo.shim, "utf8").replace(/then '([^']+)' "\$@"; echo/, "then echo");
  fs.writeFileSync(repo.shim, shim);
  fs.writeFileSync(path.join(repo.shimDir, "block"), "");
  const msg = publishMessage(broker, { remote: "origin", branch: "feature/n", commit: repo.head }, null);
  const inflight = broker.handle(msg);
  const pidFile = path.join(repo.shimDir, "pid");
  for (let i = 0; i < 300 && !fs.existsSync(pidFile); i += 1) await new Promise((r) => setTimeout(r, 20));
  const second = openHostBroker(repo, policy, { credentials });
  const rec = await second.broker.handle({ type: "reconcile", request: msg.request, args: msg.args });
  assert.equal(rec.state, "reconciled-failed", JSON.stringify(rec));
  assert.equal(remoteRef(repo, "refs/heads/feature/n"), null);
  process.kill(Number(fs.readFileSync(pidFile, "utf8").trim()), "SIGKILL");
  await inflight;
  assert.equal(remoteRef(repo, "refs/heads/feature/n"), null, "nothing re-pushed");
});

test("git.publish: a revocation (epoch bump) between authorize and dispatch refuses, and nothing is pushed", async () => {
  const { repo, broker, journalFile } = setup();
  const msg = publishMessage(broker, { remote: "origin", branch: "feature/r", commit: repo.head }, null);
  const auth = broker.authorize(msg.request, msg.args);
  assert.equal(auth.kind, "pending");
  broker.revoke();
  const res = await broker.dispatch(auth.kind === "pending" ? auth.pendingId : "");
  assert.equal(res.ok, false);
  assert.equal(res.refusal, "authority_changed");
  assert.equal(pushCount(repo), 0);
  assert.equal(remoteRef(repo, "refs/heads/feature/r"), null);
  assert.deepEqual(journalTrail(journalFile), ["decision:allow", "effect:expired"]);
});

test("git.publish: a revocation while the broker fetches its token refuses before any intent", async () => {
  await withFake(async (fake) => {
    const repo = hostRepo();
    const policy = hostPolicy(path.join(repo.outside, "policy.json"));
    const stateRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-host-state-")));
    fs.writeFileSync(path.join(stateRoot, "github-app.pem"), fake.privateKeyPem(), { mode: 0o600 });
    const config = hostConfig({ apiBaseUrl: fake.baseUrl });
    const credentials = new GitHubAppCredentialProvider({ ...appSettings(fake, config), stateRoot });
    const { broker, journalFile } = openHostBroker(repo, policy, { credentials, config });
    fake.onTokenRequest = () => broker.revoke();
    const res = await broker.handle(publishMessage(broker, { remote: "origin", branch: "feature/t", commit: repo.head }, null));
    assert.equal(res.refusal, "authority_changed", JSON.stringify(res));
    assert.equal(pushCount(repo), 0);
    assert.deepEqual(journalTrail(journalFile), ["decision:allow", "effect:expired"]);
    assert.equal(everythingWritten(journalFile, [res]).includes(fake.issued[0]!), false);
  });
});

test("git.publish and delivery.mutate are dispatched only with a host configuration, and no cell becomes prevention", async () => {
  const repo = hostRepo();
  const policy = hostPolicy(path.join(repo.outside, "policy.json"));
  const { broker } = openHostBroker(repo, policy, { credentials: new TestCredentialProvider("x") });
  const view = broker.capabilityView();
  assert.deepEqual([...(view.capabilities?.dispatched ?? [])].sort(), ["delivery.mutate", "git.publish", "process.spawn", "workspace.write"]);
  assert.ok(view.capabilities?.rows.every((r) => r.level !== "prevention"), "a broker path is not prevention");
  const plain = openBroker(repo.root, policy);
  assert.deepEqual([...(plain.broker.capabilityView().capabilities?.dispatched ?? [])].sort(), ["process.spawn", "workspace.write"]);
  const res = await plain.broker.handle(publishMessage(plain.broker, { remote: "origin", branch: "feature/u", commit: repo.head }, null));
  assert.equal(res.state, "unsupported");
  assert.equal(pushCount(repo), 0);
});

// --- delivery.mutate ---------------------------------------------------------------------------------------------

function pullSetup(fake: FakeGitHub) {
  const repo = hostRepo();
  const policy = hostPolicy(path.join(repo.outside, "policy.json"));
  const token = testToken();
  fake.accepted.add(token);
  const credentials = new TestCredentialProvider(token);
  const config = hostConfig({ apiBaseUrl: fake.baseUrl });
  const opened = openHostBroker(repo, policy, { credentials, config });
  return { repo, policy, token, credentials, config, ...opened };
}

const PR = { head: "feature/x", base: "main", title: "Add x", body: "Adds x.\n" };

test("delivery.mutate: creates one pull request through the REST API and records digests only", async () => {
  await withFake(async (fake) => {
    const { broker, journalFile, token } = pullSetup(fake);
    const res = await broker.handle(pullMessage(broker, PR, fake.host));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.state, "confirmed");
    assert.equal(fake.posts, 1);
    assert.deepEqual(fake.createBodies[0], { head: PR.head, base: PR.base, title: PR.title, body: PR.body });
    assert.equal(res.result?.pullNumber, 100);
    assert.equal(res.result?.existing, 0);
    assert.deepEqual(journalTrail(journalFile), ["decision:allow", "effect:dispatch-intent", "effect:confirmed"]);
    const written = everythingWritten(journalFile, [res]);
    assert.equal(written.includes(token), false);
    assert.equal(written.includes(PR.body.trim()), false, "receipts carry digests, not the body");
  });
});

test("delivery.mutate: an existing open pull request for head and base is success with its reference, never a second create", async () => {
  await withFake(async (fake) => {
    const number = fake.addPull({ head: PR.head, base: PR.base, title: "older", body: "", state: "open" });
    const { broker } = pullSetup(fake);
    const res = await broker.handle(pullMessage(broker, PR, fake.host));
    assert.equal(res.state, "confirmed", JSON.stringify(res));
    assert.equal(res.result?.pullNumber, number);
    assert.equal(res.result?.existing, 1);
    assert.equal(res.result?.titleMismatch, 1, "idempotency is keyed on head and base; a different title is flagged");
    assert.equal(res.result?.bodyMismatch, 1);
    assert.match(res.detail ?? "", /title and body differ/);
    assert.equal(fake.posts, 0);
  });
});

test("delivery.mutate: an existing open pull request with the requested title and body carries no mismatch flags", async () => {
  await withFake(async (fake) => {
    fake.addPull({ head: PR.head, base: PR.base, title: PR.title, body: PR.body, state: "open" });
    const { broker } = pullSetup(fake);
    const res = await broker.handle(pullMessage(broker, PR, fake.host));
    assert.equal(res.state, "confirmed", JSON.stringify(res));
    assert.equal(res.result?.titleMismatch, 0);
    assert.equal(res.result?.bodyMismatch, 0);
  });
});

test("delivery.mutate: the request binds repository, head, base and the title and body digests", async () => {
  await withFake(async (fake) => {
    const { broker } = pullSetup(fake);
    const msg = pullMessage(broker, PR, fake.host);
    const changed = { ...msg, args: { ...PR, title: "Something else" } };
    assert.equal((await broker.handle(changed)).refusal, "request_changed");
    const t = template(broker.prepare({ kind: "delivery.mutate" }));
    const other = { title: "Something else", head: PR.head, base: PR.base, body: PR.body };
    const wrongId = buildAdmissionRequest(t, { ...(msg.request as { resourceIdentity: object }).resourceIdentity }, other);
    assert.equal((await broker.handle({ type: "dispatch", request: wrongId, args: other })).refusal, "request_changed", "objectId binds the title digest");
    assert.equal((await broker.handle(pullMessage(broker, PR, fake.host, { project: "other/repo" }))).refusal, "policy_denied");
    assert.equal((await broker.handle(pullMessage(broker, PR, "api.github.com"))).refusal, "policy_denied");
    assert.equal((await broker.handle(pullMessage(broker, { ...PR, head: "main" }, fake.host))).refusal, "policy_denied");
    assert.equal(fake.posts, 0);
  });
});

test("delivery.mutate: a definite refusal from the API is failed, never unknown", async () => {
  await withFake(async (fake) => {
    fake.postMode = "422-validation";
    const { broker } = pullSetup(fake);
    const res = await broker.handle(pullMessage(broker, PR, fake.host));
    assert.equal(res.state, "failed", JSON.stringify(res));
    assert.equal(fake.posts, 1);
  });
});

test("delivery.mutate: an ambiguous answer (5xx after the create) is unknown and is settled by lookup, never by a second POST", async () => {
  await withFake(async (fake) => {
    fake.postMode = "500-after-create";
    const { broker } = pullSetup(fake);
    const msg = pullMessage(broker, PR, fake.host);
    const res = await broker.handle(msg);
    assert.equal(res.state, "unknown", JSON.stringify(res));
    fake.postMode = "normal";
    const rec = await broker.handle({ type: "reconcile", request: msg.request, args: msg.args });
    assert.equal(rec.state, "reconciled-confirmed", JSON.stringify(rec));
    assert.equal(rec.result?.pullNumber, 100);
    assert.equal(fake.posts, 1, "one POST in total");
  });
});

test("delivery.mutate: a crash between intent and outcome is unknown; lookup reconciles it and nothing is created twice", async () => {
  await withFake(async (fake) => {
    fake.postMode = "hang-after-create";
    const { repo, policy, broker, credentials, config, token } = pullSetup(fake);
    const msg = pullMessage(broker, PR, fake.host);
    const { operationId, attemptId } = msg.request as { operationId: string; attemptId: string };
    const inflight = broker.handle(msg);
    for (let i = 0; i < 300 && fake.posts === 0; i += 1) await new Promise((r) => setTimeout(r, 20));
    assert.equal(fake.posts, 1);
    const second = openHostBroker(repo, policy, { credentials, config });
    assert.equal(second.broker.attemptState(operationId, attemptId), "unknown");
    const rec = await second.broker.handle({ type: "reconcile", request: msg.request, args: msg.args });
    assert.equal(rec.state, "reconciled-confirmed", JSON.stringify(rec));
    assert.equal(fake.posts, 1);
    assert.deepEqual(journalTrail(second.journalFile), ["decision:allow", "effect:dispatch-intent", "effect:unknown", "effect:reconciled-confirmed"]);
    await fake.stop().catch(() => undefined);
    const late = await inflight;
    assert.notEqual(late.state, "confirmed");
    assert.equal(everythingWritten(second.journalFile, [rec, late]).includes(token), false);
    await fake.start();
  });
});

for (const [label, change] of [
  ["merged", { state: "closed", merged: true }],
  ["closed", { state: "closed", merged: false }],
] as const) {
  test(`delivery.mutate: a pull request ${label} before reconciliation still reconciles as confirmed, so no second one is created`, async () => {
    await withFake(async (fake) => {
      fake.postMode = "500-after-create";
      const { broker } = pullSetup(fake);
      const msg = pullMessage(broker, PR, fake.host);
      assert.equal((await broker.handle(msg)).state, "unknown");
      Object.assign(fake.pulls[0]!, change);
      const rec = await broker.handle({ type: "reconcile", request: msg.request, args: msg.args });
      assert.equal(rec.state, "reconciled-confirmed", JSON.stringify(rec));
      assert.equal(rec.result?.pullNumber, 100);
      assert.equal(rec.result?.state, "closed");
      assert.equal(fake.posts, 1, "one POST in total");
    });
  });
}

test("delivery.mutate: an older closed pull request with another title for the same branches does not reconcile as ours", async () => {
  await withFake(async (fake) => {
    fake.postMode = "500-after-create";
    const { broker } = pullSetup(fake);
    const msg = pullMessage(broker, PR, fake.host);
    assert.equal((await broker.handle(msg)).state, "unknown");
    fake.pulls.length = 0;
    fake.addPull({ head: PR.head, base: PR.base, title: "an earlier attempt", body: "", state: "closed" });
    const rec = await broker.handle({ type: "reconcile", request: msg.request, args: msg.args });
    assert.notEqual(rec.state, "reconciled-confirmed", JSON.stringify(rec));
    assert.equal(rec.refusal, "reconcile_inconclusive", "a floor was recorded: the create may still complete, so the attempt stays unknown");
  });
});

test("delivery.mutate: with a floor recorded, no pull request yet is inconclusive; one that appears later reconciles, and no second is created meanwhile", async () => {
  await withFake(async (fake) => {
    fake.postMode = "500-no-create";
    const { broker } = pullSetup(fake);
    const msg = pullMessage(broker, PR, fake.host);
    const { operationId, attemptId } = msg.request as { operationId: string; attemptId: string };
    assert.equal((await broker.handle(msg)).state, "unknown");
    const early = await broker.handle({ type: "reconcile", request: msg.request, args: msg.args });
    assert.equal(early.ok, false);
    assert.equal(early.state, "unknown", JSON.stringify(early));
    assert.equal(early.refusal, "reconcile_inconclusive");
    assert.match(early.detail ?? "", /may still complete/);
    assert.equal(broker.attemptState(operationId, attemptId), "unknown", "never reconciled-failed while the POST may still land");
    assert.equal(broker.prepare({ kind: "delivery.mutate", operationId }).ok, false, "no new attempt, so no second create, while it is unknown");
    // The timed-out create completes on GitHub after all, and is closed before the next reconcile.
    fake.addPull({ head: PR.head, base: PR.base, title: PR.title, body: PR.body, state: "closed" });
    const rec = await broker.handle({ type: "reconcile", request: msg.request, args: msg.args });
    assert.equal(rec.state, "reconciled-confirmed", JSON.stringify(rec));
    assert.equal(rec.result?.pullNumber, 100);
    assert.equal(fake.posts, 1, "one POST in total");
  });
});

test("delivery.mutate: with no floor recorded the create was never sent, so reconciliation records reconciled-failed", async () => {
  await withFake(async (fake) => {
    // The broker stops after its intent, during the pre-create lookup: before the floor and before any POST.
    fake.hangNextList = true;
    const { repo, policy, broker, credentials, config } = pullSetup(fake);
    const msg = pullMessage(broker, PR, fake.host);
    const { operationId, attemptId } = msg.request as { operationId: string; attemptId: string };
    const inflight = broker.handle(msg);
    for (let i = 0; i < 300 && fake.lists === 0; i += 1) await new Promise((r) => setTimeout(r, 20));
    assert.equal(fake.lists, 1);
    const second = openHostBroker(repo, policy, { credentials, config });
    assert.equal(second.broker.attemptState(operationId, attemptId), "unknown");
    const rec = await second.broker.handle({ type: "reconcile", request: msg.request, args: msg.args });
    assert.equal(rec.state, "reconciled-failed", JSON.stringify(rec));
    assert.match(rec.detail ?? "", /never sent/);
    assert.equal(fake.posts, 0);
    await fake.stop().catch(() => undefined);
    const late = await inflight;
    assert.notEqual(late.state, "confirmed");
    await fake.start();
  });
});

test("an outcome that could not be journaled is unknown in this process too, so reconcile settles it without a restart", async () => {
  const { repo, broker, journal } = setup();
  const append = journal.append.bind(journal);
  let failNext = true;
  journal.append = ((record: Parameters<typeof append>[0], opts?: Parameters<typeof append>[1]) => {
    if (failNext && record.receiptKind === "effect" && record.state !== "dispatch-intent") {
      failNext = false;
      throw new Error("disk full");
    }
    return append(record, opts);
  }) as typeof journal.append;
  const msg = publishMessage(broker, { remote: "origin", branch: "feature/j", commit: repo.head }, null);
  const { operationId, attemptId } = msg.request as { operationId: string; attemptId: string };
  const res = await broker.handle(msg);
  assert.equal(res.state, "unknown", JSON.stringify(res));
  assert.equal(res.refusal, "journal_unavailable");
  assert.equal(broker.attemptState(operationId, attemptId), "unknown");
  const rec = await broker.handle({ type: "reconcile", request: msg.request, args: msg.args });
  assert.equal(rec.state, "reconciled-confirmed", JSON.stringify(rec));
  assert.equal(pushCount(repo), 1, "settled by reading the remote, never a second push");
});

// --- credentials -------------------------------------------------------------------------------------------------

function appSettings(fake: FakeGitHub, config = hostConfig({ apiBaseUrl: fake.baseUrl })) {
  return { appId: fake.appId, installationId: fake.installationId, privateKeyFile: "github-app.pem", apiBaseUrl: config.github.apiBaseUrl, repository: config.github.repository };
}

function stateWithKey(fake: FakeGitHub, mode = 0o600): string {
  const stateRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-host-state-")));
  const key = path.join(stateRoot, "github-app.pem");
  fs.writeFileSync(key, fake.privateKeyPem(), { mode });
  fs.chmodSync(key, mode);
  return stateRoot;
}

test("GitHub App credentials: a signed JWT buys an installation token scoped to the repository and two permissions, cached in memory", async () => {
  await withFake(async (fake) => {
    const provider = new GitHubAppCredentialProvider({ ...appSettings(fake), stateRoot: stateWithKey(fake) });
    const t1 = await provider.token();
    const t2 = await provider.token();
    assert.equal(fake.tokenRequests.length, 1, "cached in memory for its short TTL");
    assert.equal(t1.reveal(), fake.issued[0]);
    assert.equal(t2.reveal(), t1.reveal());
    const req = fake.tokenRequests[0]!;
    assert.deepEqual(req.body, { repositories: ["widgets"], permissions: { contents: "write", pull_requests: "write" } });
    assert.deepEqual(req.jwt.header, { alg: "RS256", typ: "JWT" });
    assert.equal(req.jwt.payload.iss, fake.appId);
    assert.equal(JSON.stringify(t1), '"[redacted]"');
    assert.equal(String(t1), "[redacted]");
  });
});

test("GitHub App credentials: a token granted more than was asked is refused", async () => {
  await withFake(async (fake) => {
    fake.extraPermission = true;
    const provider = new GitHubAppCredentialProvider({ ...appSettings(fake), stateRoot: stateWithKey(fake) });
    await assert.rejects(provider.token(), (e: unknown) => e instanceof HostCredentialError && /administration/.test(e.message) && !e.message.includes(fake.issued[0]!));
  });
});

test("GitHub App credentials: a key file readable by group or others, a symlink, or one outside the state dir is refused", async () => {
  await withFake(async (fake) => {
    const loose = new GitHubAppCredentialProvider({ ...appSettings(fake), stateRoot: stateWithKey(fake, 0o644) });
    await assert.rejects(loose.token(), (e: unknown) => e instanceof HostCredentialError && e.code === "key_file" && /0600/.test(e.message));
    const stateRoot = stateWithKey(fake);
    fs.renameSync(path.join(stateRoot, "github-app.pem"), path.join(stateRoot, "real.pem"));
    fs.symlinkSync(path.join(stateRoot, "real.pem"), path.join(stateRoot, "github-app.pem"));
    const linked = new GitHubAppCredentialProvider({ ...appSettings(fake), stateRoot });
    await assert.rejects(linked.token(), (e: unknown) => e instanceof HostCredentialError && e.code === "key_file");
    const outside = stateWithKey(fake);
    const escaped = new GitHubAppCredentialProvider({ ...appSettings(fake), privateKeyFile: path.join(outside, "github-app.pem"), stateRoot: stateWithKey(fake) });
    await assert.rejects(escaped.token(), (e: unknown) => e instanceof HostCredentialError && e.code === "key_file" && /state dir/.test(e.message));
    assert.equal(fake.tokenRequests.length, 0, "no key was used");
  });
});

test("GitHub Actions OIDC credentials refuse plainly as not implemented", async () => {
  const provider = new GitHubActionsOidcCredentialProvider();
  await assert.rejects(provider.token(), (e: unknown) => e instanceof HostCredentialError && e.code === "not_implemented" && /not implemented/.test(e.message));
});

test("SecretToken never serializes its value", () => {
  const t = new SecretToken("ghs_secretvalue");
  assert.equal(JSON.stringify({ t }), '{"t":"[redacted]"}');
  assert.equal(`${t}`, "[redacted]");
  assert.equal(t.reveal(), "ghs_secretvalue");
});

// --- configuration -------------------------------------------------------------------------------------------------

test("the host configuration loads at start; a key with loose permissions refuses the broker", async () => {
  const stateRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-host-state-")));
  const file = path.join(stateRoot, "host.json");
  fs.writeFileSync(file, `${JSON.stringify({ ...hostConfig() })}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  const pem = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  fs.writeFileSync(path.join(stateRoot, "github-app.pem"), pem, { mode: 0o644 });
  fs.chmodSync(path.join(stateRoot, "github-app.pem"), 0o644);
  assert.throws(() => loadHostBrokers(file, stateRoot), (e: unknown) => e instanceof BrokerSetupError && e.code === "config" && /0600/.test(e.message));
  fs.chmodSync(path.join(stateRoot, "github-app.pem"), 0o600);
  const ctx = loadHostBrokers(file, stateRoot);
  assert.equal(ctx.credentials.kind, "github-app");
  assert.equal(ctx.config.github.repository, REPOSITORY);
  fs.chmodSync(file, 0o666);
  assert.throws(() => loadHostBrokers(file, stateRoot), (e: unknown) => e instanceof BrokerSetupError && e.code === "config");
  fs.chmodSync(file, 0o600);
  fs.writeFileSync(file, `${JSON.stringify({ schema: "opengantry.admission-host.v1", github: { ...hostConfig().github, apiBaseUrl: "http://api.example.com" } })}\n`);
  assert.throws(() => loadHostBrokers(file, stateRoot), (e: unknown) => e instanceof BrokerSetupError && /https/.test(e.message));
});

test("remote URLs canonicalize to one form; credentials, other schemes and plain http off loopback are refused", () => {
  for (const u of ["https://github.com/acme/widgets.git", "https://GitHub.com/acme/widgets/", "git@github.com:acme/widgets.git", "ssh://git@github.com/acme/widgets", "https://x-access-token@github.com:443/acme/widgets.git"]) {
    assert.equal(canonicalRemoteUrl(u), CANONICAL_REMOTE, u);
  }
  assert.equal(canonicalRemoteUrl("http://127.0.0.1:8080/acme/widgets.git"), "https://127.0.0.1/acme/widgets");
  for (const u of ["https://user:pw@github.com/acme/widgets", "http://github.com/acme/widgets", "file:///tmp/x", "ext::sh -c x", "https://github.com/acme", "https://github.com/acme/widgets/extra"]) {
    assert.equal(canonicalRemoteUrl(u), null, u);
  }
  assert.equal(branchMatches("release/1.0", ["release/*"]), true);
  assert.equal(branchMatches("release/1.0/hotfix", ["release/*"]), false);
  assert.equal(branchMatches("release/1.0/hotfix", ["release/**"]), true);
  assert.equal(branchMatches("feature/x", ["release/*", "main"]), false);
});

test("no response from a host dispatch carries a token-shaped string", async () => {
  const { repo, broker, token } = setup();
  const responses: BrokerResponse[] = [];
  responses.push(await broker.handle(publishMessage(broker, { remote: "origin", branch: "feature/q", commit: repo.head }, null)));
  responses.push(broker.capabilityView());
  for (const r of responses) assert.equal(JSON.stringify(r).includes(token), false);
  assert.doesNotMatch(responses.map((r) => JSON.stringify(r)).join("\n"), /ghs_|x-access-token|Authorization/i);
});

// --- review round 2 ------------------------------------------------------------------------------------------------

/** startBroker options for a host repo: state dir and socket outside the work tree, the policy in `outside`. */
function serveOptions(root: string, outside: string) {
  const sockDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-hs-")));
  const policy = hostPolicy(path.join(outside, "serve-policy.json"));
  return { root, harness: "claude-code", contractDigest: CONTRACT_DIGEST, policy, socket: path.join(sockDir, "b.sock"), assumePlatform: "ubuntu-26.04-x64", env: { ...process.env, GANTRY_STATE_DIR: path.join(outside, "state") } };
}

/** startBroker must refuse with a config error matching `re`; a broker that starts anyway is closed, then the test fails. */
async function assertServeRefused(opts: ReturnType<typeof serveOptions>, re: RegExp): Promise<void> {
  let started: Awaited<ReturnType<typeof startBroker>>;
  try {
    started = await startBroker(opts);
  } catch (e) {
    assert.ok(e instanceof BrokerSetupError && e.code === "config" && re.test(e.message), String(e));
    return;
  }
  await started.close();
  assert.fail(`the broker started on ${opts.root}, pinned to ${started.plan.gitDir}`);
}

/** A linked worktree of a fresh host repo, and the repo itself. */
function linkedWorktree(): { main: HostRepo; linked: string } {
  const main = hostRepo();
  const linked = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-host-wt-"))), "wt");
  git(main.root, ["worktree", "add", "-q", "-b", "wt-branch", linked, main.head]);
  return { main, linked };
}

test("serve: the git dir is resolved without git and must belong to the work tree; a rewritten .git file refuses the broker", async () => {
  const { main, linked } = linkedWorktree();
  // A normal linked worktree starts, pinned to its own worktree entry.
  const ok = await startBroker(serveOptions(linked, main.outside));
  try {
    assert.equal(ok.plan.gitDir, path.join(main.root, ".git", "worktrees", "wt"));
  } finally {
    await ok.close();
  }
  const other = outsideRepo();
  const dotGit = path.join(linked, ".git");
  // (a) `.git` names another repository's git dir: git itself follows it.
  fs.writeFileSync(dotGit, `gitdir: ${other.gitDir}\n`);
  assert.equal(git(linked, ["rev-parse", "--absolute-git-dir"]), other.gitDir, "git in the work tree now names the other repository");
  await assertServeRefused(serveOptions(linked, main.outside), /not a linked worktree entry/);
  // (b) `.git` names another repository's worktree entry, whose back-pointer names that repository's work tree.
  const otherWt = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-host-owt-"))), "x");
  git(path.dirname(other.gitDir), ["worktree", "add", "-q", "-b", "x", otherWt]);
  fs.writeFileSync(dotGit, `gitdir: ${path.join(other.gitDir, "worktrees", "x")}\n`);
  assert.equal(git(linked, ["rev-parse", "--absolute-git-dir"]), path.join(other.gitDir, "worktrees", "x"));
  await assertServeRefused(serveOptions(linked, main.outside), /belongs to another work tree/);
  // A symlinked .git refuses too.
  fs.rmSync(dotGit);
  fs.symlinkSync(path.join(main.root, ".git", "worktrees", "wt"), dotGit);
  await assertServeRefused(serveOptions(linked, main.outside), /neither a directory nor a regular file/);
  // A plain (non-linked) repository still starts on its own .git directory.
  const plain = await startBroker(serveOptions(main.root, main.outside));
  try {
    assert.equal(plain.plan.gitDir, path.join(main.root, ".git"));
  } finally {
    await plain.close();
  }
});

test("git.publish: an object file with a second hard link is refused with the repack remedy, and nothing is pushed", async () => {
  const { repo, broker } = setup();
  git(repo.root, ["repack", "-a", "-d", "-q"]);
  const packDir = path.join(repo.root, ".git", "objects", "pack");
  const pack = fs.readdirSync(packDir).find((f) => f.endsWith(".pack"))!;
  // Stands in for `ln <a file the sandbox cannot read> .git/objects/pack/...`: the copy must not export a second name.
  const elsewhere = path.join(repo.outside, "unreadable-elsewhere");
  fs.linkSync(path.join(packDir, pack), elsewhere);
  const res = await broker.handle(publishMessage(broker, { remote: "origin", branch: "feature/hl", commit: repo.head }, null));
  assert.equal(res.refusal, "dispatch_check_failed", JSON.stringify(res));
  assert.match(res.detail ?? "", /2 links.*git repack -a -d/);
  assert.equal(pushCount(repo), 0);
  assert.equal(remoteRef(repo, "refs/heads/feature/hl"), null);
  fs.rmSync(elsewhere);
  const ok = await broker.handle(publishMessage(broker, { remote: "origin", branch: "feature/hl2", commit: repo.head }, null));
  assert.equal(ok.state, "confirmed", JSON.stringify(ok));
});

test("delivery.mutate: a closed pull request that existed before the create never reconciles as ours, even with the same title and body", async () => {
  await withFake(async (fake) => {
    const stale = fake.addPull({ head: PR.head, base: PR.base, title: PR.title, body: PR.body, state: "closed" });
    fake.postMode = "500-no-create";
    const { repo, policy, broker, credentials, config } = pullSetup(fake);
    const msg = pullMessage(broker, PR, fake.host);
    assert.equal((await broker.handle(msg)).state, "unknown");
    assert.equal(fake.pulls.length, 1, "the create never happened");
    // After a restart too: the floor is the broker's own durable attempt state.
    const second = openHostBroker(repo, policy, { credentials, config });
    const rec = await second.broker.handle({ type: "reconcile", request: msg.request, args: msg.args });
    assert.notEqual(rec.state, "reconciled-confirmed", JSON.stringify(rec));
    assert.equal(rec.refusal, "reconcile_inconclusive", "the stale PR is at the floor; the create may still complete, so the attempt stays unknown");
    assert.match(rec.detail ?? "", new RegExp(`newer than #${stale}`));
    assert.equal(fake.posts, 1);
  });
});

test("delivery.mutate: a full page of pull requests is refused as ambiguous, and nothing is created", async () => {
  await withFake(async (fake) => {
    for (let i = 0; i < 100; i += 1) fake.addPull({ head: PR.head, base: PR.base, title: `old ${i}`, body: "", state: "closed" });
    const { broker } = pullSetup(fake);
    const res = await broker.handle(pullMessage(broker, PR, fake.host));
    assert.equal(res.state, "failed", JSON.stringify(res));
    assert.match(res.detail ?? "", /filled one page/);
    assert.equal(fake.posts, 0);
  });
});

test("GitHub Enterprise Server: an apiBaseUrl of https://HOST/api/v3 is accepted, and the token exchange and the create go under it", async () => {
  const ok = (u: string): boolean => hostConfigSchema.safeParse({ ...hostConfig(), github: { ...hostConfig().github, apiBaseUrl: u } }).success;
  assert.equal(ok("https://ghe.example.com/api/v3"), true);
  assert.equal(ok("https://ghe.example.com/api/v3/"), true);
  assert.equal(ok("https://ghe.example.com/"), true);
  for (const bad of ["https://ghe.example.com/api", "https://ghe.example.com/api/v3/x", "https://ghe.example.com/other", "https://ghe.example.com/api/v3?x=1", "https://ghe.example.com/api/v3#f", "https://u:p@ghe.example.com/api/v3", "http://ghe.example.com/api/v3"]) {
    assert.equal(ok(bad), false, bad);
  }
  const gitOk = hostConfigSchema.safeParse({ ...hostConfig(), github: { ...hostConfig().github, gitBaseUrl: "https://ghe.example.com/api/v3" } }).success;
  assert.equal(gitOk, false, "only the API base may carry the /api/v3 path");
  await withFake(async (fake) => {
    fake.apiPrefix = "/api/v3";
    const config = hostConfig({ apiBaseUrl: `${fake.baseUrl}/api/v3/` });
    assert.equal(config.github.apiBaseUrl, `${fake.baseUrl}/api/v3`);
    const repo = hostRepo();
    const policy = hostPolicy(path.join(repo.outside, "policy.json"));
    const credentials = new GitHubAppCredentialProvider({ ...appSettings(fake, config), stateRoot: stateWithKey(fake) });
    const { broker } = openHostBroker(repo, policy, { credentials, config });
    const res = await broker.handle(pullMessage(broker, PR, fake.host));
    assert.equal(res.state, "confirmed", JSON.stringify(res));
    assert.equal(fake.tokenRequests.length, 1, "the installation token was exchanged under /api/v3");
    assert.equal(fake.posts, 1, "the pull request was created under /api/v3");
  });
});
