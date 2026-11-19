/**
 * Host broker reconciliation (issue #356, ADM06; PR #376 review rounds 4 and 5): a read never proves that a push failed
 * (a ref back at the expected old value may have been reset after the push landed), a create's floor is read from its
 * journaled dispatch intent (never from a state dir) and one that cannot be recovered is inconclusive, and only the
 * operator, outside the sandbox and with no broker running, asserts a failure (`gantry admission reconcile
 * --assume-failed`), journaled as an assertion.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BrokerSetupError, assumeAttemptFailed, brokerStateDir } from "#missions/admission/serve.js";
import { admissionJournalPath } from "#missions/admission/journal-file.js";
import { FakeGitHub, TestCredentialProvider, digestOf, git, hostConfig, hostPolicy, hostRepo, openHostBroker, publishMessage, pullMessage, pushCount, remoteRef, testToken } from "./host-fixtures.js";

function setup() {
  const repo = hostRepo();
  const policy = hostPolicy(path.join(repo.outside, "policy.json"));
  const credentials = new TestCredentialProvider(testToken());
  return { repo, policy, credentials, ...openHostBroker(repo, policy, { credentials }) };
}

async function withFake<T>(fn: (fake: FakeGitHub) => Promise<T>): Promise<T> {
  const fake = await new FakeGitHub().start();
  try {
    return await fn(fake);
  } finally {
    await fake.stop();
  }
}

function pullSetup(fake: FakeGitHub) {
  const repo = hostRepo();
  const policy = hostPolicy(path.join(repo.outside, "policy.json"));
  const token = testToken();
  fake.accepted.add(token);
  const credentials = new TestCredentialProvider(token);
  const config = hostConfig({ apiBaseUrl: fake.baseUrl });
  return { repo, policy, credentials, config, ...openHostBroker(repo, policy, { credentials, config }) };
}

const PR = { head: "feature/x", base: "main", title: "Add x", body: "Adds x.\n" };

test("git.publish: a failed push without git's porcelain refusal is unknown even when the ref is unchanged, and reconciliation cannot call it failed", async () => {
  const { repo, broker } = setup();
  fs.writeFileSync(path.join(repo.shimDir, "reject"), "error: failed to push some refs\n");
  const msg = publishMessage(broker, { remote: "origin", branch: "feature/e", commit: repo.head }, null);
  const res = await broker.handle(msg);
  assert.equal(res.state, "unknown", JSON.stringify(res));
  assert.equal(remoteRef(repo, "refs/heads/feature/e"), null);
  fs.rmSync(path.join(repo.shimDir, "reject"));
  const { operationId, attemptId } = msg.request as { operationId: string; attemptId: string };
  // The ref is still absent (the expected old value), which does not prove the push failed (PR #376 review round 4).
  const rec = await broker.handle({ type: "reconcile", request: msg.request, args: msg.args });
  assert.equal(rec.refusal, "reconcile_inconclusive", JSON.stringify(rec));
  assert.equal(broker.attemptState(operationId, attemptId), "unknown");
  assert.equal(pushCount(repo), 1, "reconciliation pushed nothing");
});

test("git.publish: a push that never landed stays unknown on reconciliation; only the operator's assertion, journaled as one, settles it", async () => {
  const { repo, policy, broker, credentials } = setup();
  // Block before the push itself: the shim hangs without pushing.
  const shim = fs.readFileSync(repo.shim, "utf8").replace(/then '([^']+)' "\$@"; echo/, "then echo");
  fs.writeFileSync(repo.shim, shim);
  fs.writeFileSync(path.join(repo.shimDir, "block"), "");
  const msg = publishMessage(broker, { remote: "origin", branch: "feature/n", commit: repo.head }, null);
  const inflight = broker.handle(msg);
  const pidFile = path.join(repo.shimDir, "pid");
  for (let i = 0; i < 300 && !fs.existsSync(pidFile); i += 1) await new Promise((r) => setTimeout(r, 20));
  const { operationId, attemptId } = msg.request as { operationId: string; attemptId: string };
  const second = openHostBroker(repo, policy, { credentials });
  const rec = await second.broker.handle({ type: "reconcile", request: msg.request, args: msg.args });
  assert.equal(rec.refusal, "reconcile_inconclusive", JSON.stringify(rec));
  assert.equal(second.broker.attemptState(operationId, attemptId), "unknown", "the ref at the expected old value is no proof of failure");
  assert.match(rec.detail ?? "", /assume-failed/);
  assert.equal(second.broker.prepare({ kind: "git.publish", operationId }).ok, false, "no new attempt, so no re-push, while it is unknown");
  assert.equal(remoteRef(repo, "refs/heads/feature/n"), null);
  process.kill(Number(fs.readFileSync(pidFile, "utf8").trim()), "SIGKILL");
  await inflight;
  // The operator, outside the sandbox and with no broker running, asserts the failure.
  const env = { ...process.env, GANTRY_STATE_DIR: path.join(repo.outside, "state") };
  const asserted = assumeAttemptFailed(repo.root, `${operationId}/${attemptId}`, env);
  const third = openHostBroker(repo, policy, { credentials });
  assert.equal(third.broker.attemptState(operationId, attemptId), "reconciled-failed");
  const records = fs.readFileSync(third.journalFile, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { recordDigest: string; receipt: { state?: string; provenance?: { observer: string; evidenceDigest: string | null } } });
  const last = records.at(-1)!;
  assert.equal(last.recordDigest, asserted.recordDigest);
  assert.equal(last.receipt.state, "reconciled-failed");
  assert.deepEqual(last.receipt.provenance, { observer: "operator-assertion", evidenceDigest: asserted.assertionDigest }, "journaled as an operator assertion, not as an observation");
  assert.equal(third.broker.prepare({ kind: "git.publish", operationId }).ok, true, "a new attempt may now be prepared");
  assert.equal(pushCount(repo), 1, "nothing re-pushed");
  assert.equal(remoteRef(repo, "refs/heads/feature/n"), null, "nothing re-pushed");
});

test("git.publish: a push that landed before another writer reset the ref to the expected old value (ABA) reconciles inconclusive, never failed; our commit confirms later", async () => {
  const { repo, broker } = setup();
  git(repo.root, ["push", "-q", repo.bare, `${repo.base}:refs/heads/topic`]);
  // The remote takes the push, the acknowledgement is lost, and another writer resets the ref to the old head.
  fs.writeFileSync(path.join(repo.shimDir, "lost-ack"), `refs/heads/topic ${repo.base}`);
  const msg = publishMessage(broker, { remote: "origin", branch: "topic", commit: repo.head }, repo.base);
  const { operationId, attemptId } = msg.request as { operationId: string; attemptId: string };
  assert.equal((await broker.handle(msg)).state, "unknown");
  fs.rmSync(path.join(repo.shimDir, "lost-ack"));
  assert.equal(pushCount(repo), 1);
  git(repo.bare, ["cat-file", "-e", `${repo.head}^{commit}`]);
  assert.equal(remoteRef(repo, "refs/heads/topic"), repo.base, "the ref is back at the expected old value");
  const rec = await broker.handle({ type: "reconcile", request: msg.request, args: msg.args });
  assert.equal(rec.ok, false);
  assert.equal(rec.state, "unknown", JSON.stringify(rec));
  assert.equal(rec.refusal, "reconcile_inconclusive");
  assert.match(rec.detail ?? "", /does not prove the push failed/);
  assert.equal(broker.attemptState(operationId, attemptId), "unknown");
  assert.equal(broker.prepare({ kind: "git.publish", operationId }).ok, false, "no new attempt while it is unknown");
  // The ref later holds our commit: a later reconcile confirms.
  git(repo.bare, ["update-ref", "refs/heads/topic", repo.head]);
  const later = await broker.handle({ type: "reconcile", request: msg.request, args: msg.args });
  assert.equal(later.state, "reconciled-confirmed", JSON.stringify(later));
  assert.equal(pushCount(repo), 1, "never a second push");
});

test("operator assertion: refused while a broker holds the instance lock, for an attempt that is not unknown, and absent from the socket", async () => {
  const { repo, policy, broker, credentials } = setup();
  fs.writeFileSync(path.join(repo.shimDir, "reject"), "error: failed to push some refs\n");
  const msg = publishMessage(broker, { remote: "origin", branch: "feature/o", commit: repo.head }, null);
  const { operationId, attemptId } = msg.request as { operationId: string; attemptId: string };
  assert.equal((await broker.handle(msg)).state, "unknown");
  fs.rmSync(path.join(repo.shimDir, "reject"));
  // The socket has no message that asserts failure: an unknown type is malformed and journals nothing.
  const forged = await broker.handle({ type: "assume-failed", request: msg.request, args: msg.args });
  assert.equal(forged.ok, false);
  assert.equal(broker.attemptState(operationId, attemptId), "unknown");
  const env = { ...process.env, GANTRY_STATE_DIR: path.join(repo.outside, "state") };
  const lock = path.join(brokerStateDir(repo.root, path.dirname(path.dirname(path.dirname(admissionJournalPath(repo.root)!))), env), "broker.lock");
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  fs.writeFileSync(lock, "running\n");
  assert.throws(() => assumeAttemptFailed(repo.root, `${operationId}/${attemptId}`, env), (e: unknown) => e instanceof BrokerSetupError && e.code === "locked");
  fs.rmSync(lock);
  const repositoryLock = path.join(repo.root, ".git", "opengantry-admission.lock");
  fs.writeFileSync(repositoryLock, "running\n");
  const otherEnv = { ...env, GANTRY_STATE_DIR: path.join(repo.outside, "second-state") };
  assert.throws(() => assumeAttemptFailed(repo.root, `${operationId}/${attemptId}`, otherEnv), (e: unknown) => e instanceof BrokerSetupError && e.code === "locked");
  fs.rmSync(repositoryLock);
  assert.throws(() => assumeAttemptFailed(repo.root, `${operationId}/at-000000000000000000000000`, env), /not unknown/);
  assert.throws(() => assumeAttemptFailed(repo.root, "no-slash", env), /operationId>\/<attemptId/);
  assumeAttemptFailed(repo.root, `${operationId}/${attemptId}`, env);
  assert.equal(fs.existsSync(lock), false, "the lock is released");
  assert.throws(() => assumeAttemptFailed(repo.root, `${operationId}/${attemptId}`, env), /reconciled-failed, not unknown/, "asserted once only");
  assert.equal(openHostBroker(repo, policy, { credentials }).broker.attemptState(operationId, attemptId), "reconciled-failed");
});

test("delivery.mutate: the dispatch intent journals the floor before the POST; reconciliation reads it from the journal, and one it cannot recover is inconclusive, never failed", async () => {
  await withFake(async (fake) => {
    fake.addPull({ head: PR.head, base: PR.base, title: "an earlier attempt", body: "", state: "closed" });
    fake.postMode = "500-no-create";
    const { repo, policy, credentials, config, broker, journalFile } = pullSetup(fake);
    const msg = pullMessage(broker, PR, fake.host);
    const { operationId, attemptId } = msg.request as { operationId: string; attemptId: string };
    assert.equal((await broker.handle(msg)).state, "unknown");
    // The intent record (hash-chained, fsynced before the effect) binds the floor: #100 existed at the lookup.
    const records = fs.readFileSync(journalFile, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { receipt: { attemptId: string; state?: string; provenance?: { evidenceDigest: string | null } } });
    const intent = records.find((r) => r.receipt.attemptId === attemptId && r.receipt.state === "dispatch-intent");
    assert.equal(intent?.receipt.provenance?.evidenceDigest, digestOf({ pullFloor: 100, operationId, attemptId }));
    const rec = await broker.handle({ type: "reconcile", request: msg.request, args: msg.args });
    assert.equal(rec.refusal, "reconcile_inconclusive", JSON.stringify(rec));
    assert.match(rec.detail ?? "", /newer than #100/);
    // A floor that matches none of the pull requests listed now (here #100 is gone) cannot be recovered: inconclusive.
    const earlier = fake.pulls.splice(0);
    const lost = await broker.handle({ type: "reconcile", request: msg.request, args: msg.args });
    assert.equal(lost.refusal, "reconcile_inconclusive", JSON.stringify(lost));
    assert.match(lost.detail ?? "", /cannot be recovered/);
    assert.equal(broker.attemptState(operationId, attemptId), "unknown", "never reconciled-failed: the POST may have been sent");
    assert.equal(broker.prepare({ kind: "delivery.mutate", operationId }).ok, false, "no new attempt, so no second create, while it is unknown");
    // A restarted broker (no state dir of any kind) recovers the floor from the journal it replays.
    fake.pulls.push(...earlier);
    fake.addPull({ head: PR.head, base: PR.base, title: PR.title, body: PR.body, state: "closed" });
    const second = openHostBroker(repo, policy, { credentials, config });
    const later = await second.broker.handle({ type: "reconcile", request: msg.request, args: msg.args });
    assert.equal(later.state, "reconciled-confirmed", JSON.stringify(later));
    assert.equal(later.result?.pullNumber, 101, "the closed pull request above the journaled floor is ours");
    assert.equal(fake.posts, 1);
  });
});
