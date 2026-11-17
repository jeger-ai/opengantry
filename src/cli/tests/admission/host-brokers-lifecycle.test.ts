/**
 * Host brokers across the broker's lifetime (issue #356; PR #376 review round 5): `close` waits for a dispatch still in
 * flight before it releases the instance lock, a restart with another state dir reconciles a create by the floor its
 * journaled dispatch intent bound (never `reconciled-failed` for want of a file), an oversized API answer is abandoned
 * while it is read and a create that got one is `unknown`, and the operator's `--assume-failed` prints its warning.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getRepoRoot, gitChildEnv } from "#git/git.js";
import { startBroker } from "#missions/admission/serve.js";
import { CONTRACT_DIGEST, journalTrail } from "./fixtures.js";
import { FakeGitHub, TestCredentialProvider, hostConfig, hostPolicy, hostRepo, openHostBroker, publishMessage, pullMessage, testToken, type HostRepo } from "./host-fixtures.js";

const CLI = path.join(getRepoRoot(), "dist", "cli", "index.js");
const PR = { head: "feature/x", base: "main", title: "Add x", body: "Adds x.\n" };

const made: string[] = [];
after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

function tmpDir(prefix: string): string {
  // sun_path is 108 bytes: a short base for the socket.
  const base = Buffer.byteLength(os.tmpdir()) < 60 ? os.tmpdir() : "/tmp";
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(base, prefix)));
  made.push(dir);
  return dir;
}

async function withFake<T>(fn: (fake: FakeGitHub) => Promise<T>): Promise<T> {
  const fake = await new FakeGitHub().start();
  try {
    return await fn(fake);
  } finally {
    await fake.stop();
  }
}

/** A state dir holding the host config and the fake's App key, as an operator sets it up (`admission-host-brokers.md`). */
function hostState(fake: FakeGitHub): string {
  const stateDir = tmpDir("og-hs-");
  const admin = path.join(stateDir, "admission");
  fs.mkdirSync(admin, { mode: 0o700 });
  fs.writeFileSync(path.join(admin, "host.json"), `${JSON.stringify(hostConfig({ apiBaseUrl: fake.baseUrl }))}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(admin, "github-app.pem"), fake.privateKeyPem(), { mode: 0o600 });
  return stateDir;
}

/** The real broker (`startBroker`, as `serve` runs it) with the host brokers, on a socket outside the work tree. */
function serveHost(repo: HostRepo, stateDir: string) {
  return startBroker({
    root: repo.root,
    harness: "claude-code",
    contractDigest: CONTRACT_DIGEST,
    policy: hostPolicy(path.join(repo.outside, "policy.json")),
    hostConfig: path.join(stateDir, "admission", "host.json"),
    socket: path.join(tmpDir("og-hsock-"), "b.sock"),
    assumePlatform: "ubuntu-26.04-x64",
    env: gitChildEnv({ GANTRY_STATE_DIR: stateDir }),
  });
}

const until = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 500 && !cond(); i += 1) await new Promise((r) => setTimeout(r, 20));
};

/**
 * Start a create the fake holds, call `close` while it is in flight, and report what `close` did before the create was
 * answered. `send` starts the dispatch: in process, or through the socket by a client that then hangs up.
 */
async function closeDuringCreate(fake: FakeGitHub, send: (running: Awaited<ReturnType<typeof serveHost>>, msg: ReturnType<typeof pullMessage>) => void) {
  const repo = hostRepo();
  const running = await serveHost(repo, hostState(fake));
  const lock = path.join(running.plan.stateDir, "broker.lock");
  fake.postMode = "hang-after-create";
  const msg = pullMessage(running.broker, PR, fake.host);
  const { operationId, attemptId } = msg.request as { operationId: string; attemptId: string };
  send(running, msg);
  await until(() => fake.posts === 1);
  let closed = false;
  const closing = running.close().then(() => (closed = true));
  await new Promise((r) => setTimeout(r, 400));
  const before = { closed, lockHeld: fs.existsSync(lock) };
  // Answered whatever happened above, so a failing assertion below never leaves the close or the create hanging.
  fake.answerHeldCreates();
  await closing;
  return { before, posts: fake.posts, lockAfter: fs.existsSync(lock), state: running.broker.attemptState(operationId, attemptId), trail: journalTrail(running.plan.journalFile).slice(-3) };
}

test("close waits for a dispatch still in flight, and only then releases the instance lock", async () => {
  await withFake(async (fake) => {
    // A dispatch no connection holds open: close must wait for the dispatch itself, not for the connections.
    const r = await closeDuringCreate(fake, (running, msg) => void running.broker.handle(msg));
    assert.equal(r.posts, 1);
    assert.equal(r.before.closed, false, "close waits for the dispatch");
    assert.equal(r.before.lockHeld, true, "the lock is held while the create may still be sent and journaled");
    assert.equal(r.lockAfter, false, "released once the dispatch settled");
    assert.equal(r.state, "confirmed");
    assert.deepEqual(r.trail, ["decision:allow", "effect:dispatch-intent", "effect:confirmed"], "the outcome was journaled before the lock went");
  });
});

test("close also waits when the socket client hung up during the dispatch", async () => {
  await withFake(async (fake) => {
    const r = await closeDuringCreate(fake, (running, msg) => {
      const client = net.createConnection(running.plan.socket);
      client.on("error", () => undefined);
      client.write(`${JSON.stringify(msg)}\n`, () => setTimeout(() => client.destroy(), 100));
    });
    assert.equal(r.before.closed, false);
    assert.equal(r.before.lockHeld, true);
    assert.equal(r.lockAfter, false);
    assert.equal(r.state, "confirmed");
  });
});

test("delivery.mutate: a restart with another state dir reconciles by the journaled floor; no floor file decides, so it is never reconciled-failed", async () => {
  await withFake(async (fake) => {
    const repo = hostRepo();
    fake.postMode = "500-no-create";
    const first = await serveHost(repo, hostState(fake));
    const msg = pullMessage(first.broker, PR, fake.host);
    const { operationId, attemptId } = msg.request as { operationId: string; attemptId: string };
    assert.equal((await first.broker.handle(msg)).state, "unknown");
    await first.close();
    // The operator restarts with another GANTRY_STATE_DIR: the journal (under the git dir) is the same, the state is not.
    const second = await serveHost(repo, hostState(fake));
    try {
      assert.equal(second.broker.attemptState(operationId, attemptId), "unknown");
      const rec = await second.broker.handle({ type: "reconcile", request: msg.request, args: msg.args });
      assert.equal(rec.refusal, "reconcile_inconclusive", JSON.stringify(rec));
      assert.equal(second.broker.attemptState(operationId, attemptId), "unknown", "the POST may have been sent: never reconciled-failed");
      assert.equal(second.broker.prepare({ kind: "delivery.mutate", operationId }).ok, false, "no new attempt, so no second create");
      // The create completes on GitHub after all, and is closed: above the journaled floor (0), it is ours.
      fake.addPull({ head: PR.head, base: PR.base, title: PR.title, body: PR.body, state: "closed" });
      const later = await second.broker.handle({ type: "reconcile", request: msg.request, args: msg.args });
      assert.equal(later.state, "reconciled-confirmed", JSON.stringify(later));
      assert.equal(fake.posts, 1);
    } finally {
      await second.close();
    }
  });
});

test("delivery.mutate: an oversized answer to the create is abandoned while it is read, and the create is unknown, settled by lookup", async () => {
  await withFake(async (fake) => {
    const repo = hostRepo();
    const token = testToken();
    fake.accepted.add(token);
    // A long read timeout: the answer must be refused for its size, not for the time a whole-body read would wait.
    const { broker } = openHostBroker(repo, hostPolicy(path.join(repo.outside, "policy.json")), { credentials: new TestCredentialProvider(token), config: hostConfig({ apiBaseUrl: fake.baseUrl }), readTimeoutMs: 60_000 });
    fake.postMode = "oversized-after-create";
    const msg = pullMessage(broker, PR, fake.host);
    const started = Date.now();
    const res = await broker.handle(msg);
    assert.equal(res.state, "unknown", JSON.stringify(res));
    assert.match(res.detail ?? "", /too large/);
    assert.ok(Date.now() - started < 30_000, "refused while reading, before any timeout");
    fake.postMode = "normal";
    const rec = await broker.handle({ type: "reconcile", request: msg.request, args: msg.args });
    assert.equal(rec.state, "reconciled-confirmed", JSON.stringify(rec));
    assert.equal(fake.posts, 1, "never a second create");
  });
});

test("gantry admission reconcile --assume-failed prints that it is an unchecked assertion needing independent evidence", () => {
  const repo = hostRepo();
  const { broker } = openHostBroker(repo, hostPolicy(path.join(repo.outside, "policy.json")), { credentials: new TestCredentialProvider(testToken()) });
  fs.writeFileSync(path.join(repo.shimDir, "reject"), "error: failed to push some refs\n");
  const msg = publishMessage(broker, { remote: "origin", branch: "feature/w", commit: repo.head }, null);
  const { operationId, attemptId } = msg.request as { operationId: string; attemptId: string };
  return broker.handle(msg).then((res) => {
    assert.equal(res.state, "unknown");
    const env = gitChildEnv({ GANTRY_STATE_DIR: path.join(repo.outside, "state") });
    const run = spawnSync(process.execPath, [CLI, "admission", "reconcile", "--assume-failed", `${operationId}/${attemptId}`], { cwd: repo.root, env, encoding: "utf8" });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    const out = `${run.stdout}\n${run.stderr}`;
    assert.match(out, /warning: .*second pull request/);
    assert.match(out, /independent evidence/);
  });
});
