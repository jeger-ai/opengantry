/**
 * The admission broker state machine, in process (issue #356 slice 3; ADM-T02, ADM-T03, ADM-T04 where provable without
 * OS confinement). Every refusal must happen before an effect: the file is not written, the process does not run.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CONTRACT_DIGEST, brokerRepo, journalTrail, manualClock, openBroker, spawnMessage, template, writeMessage, writePolicy } from "./fixtures.js";
import { buildAdmissionRequest, posixFileRef } from "#missions/admission/client.js";
import { brokerArgsSchemas, checkProcessSpawn, checkWorkspaceWrite, type DispatchCheck, type WriteIo } from "#missions/admission/dispatch.js";

const isRoot = process.getuid?.() === 0;

function setup(opts: { maxBytes?: number; denialMaxBytes?: number; spawnTimeoutMs?: number; maxTrackedAttempts?: number } = {}) {
  const { root, outside } = brokerRepo();
  const policy = writePolicy(path.join(outside, "policy.json"));
  const clock = manualClock();
  const opened = openBroker(root, policy, { clock: clock.clock, ...opts });
  return { root, outside, policy, clock, ...opened };
}

test("an allowed workspace.write writes once and journals decision, intent and outcome in that order", async () => {
  const { root, broker, journalFile } = setup();
  const res = await broker.handle(writeMessage(broker, root, "a.txt", "hello"));
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.state, "confirmed");
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "hello");
  assert.deepEqual(journalTrail(journalFile), ["decision:allow", "effect:dispatch-intent", "effect:confirmed"]);
  assert.equal(res.receipts?.length, 3);
  assert.equal(res.decision?.capabilityLevel, "unproven", "the cell keeps its level: nothing here confines the candidate");
});

test("permits never leave the broker: a response carries the decision and receipt digests only", async () => {
  const { root, broker } = setup();
  const res = await broker.handle(writeMessage(broker, root, "p.txt", "x"));
  const text = JSON.stringify(res);
  assert.equal(text.includes("opengantry.admission-permit.v1"), false);
  assert.deepEqual(Object.keys(res).sort(), ["decision", "detail", "ok", "receipts", "refusal", "result", "schema", "state", "type"]);
});

test("a forged request (a nonce this broker never handed out) is denied before dispatch", async () => {
  const { root, broker, journalFile } = setup();
  const msg = writeMessage(broker, root, "f.txt", "forged");
  const forged = { ...msg, request: { ...msg.request, nonce: "f".repeat(32) } };
  const res = await broker.handle(forged);
  assert.equal(res.state, "denied");
  assert.equal(res.refusal, "permit_unknown");
  assert.equal(fs.existsSync(path.join(root, "f.txt")), false);
  assert.deepEqual(journalTrail(journalFile), ["decision:deny"]);
});

test("a replayed request is denied (permit_reused) and the effect happens once", async () => {
  const { root, broker } = setup();
  const msg = writeMessage(broker, root, "r.txt", "once");
  assert.equal((await broker.handle(msg)).state, "confirmed");
  fs.rmSync(path.join(root, "r.txt"));
  const again = await broker.handle(msg);
  assert.equal(again.refusal, "permit_reused");
  assert.equal(fs.existsSync(path.join(root, "r.txt")), false, "the replay did not write");
});

test("a replay never changes the state of the attempt it names", async () => {
  const { root, broker } = setup();
  const msg = writeMessage(broker, root, "s.txt", "x");
  await broker.handle(msg);
  const { operationId, attemptId } = msg.request as { operationId: string; attemptId: string };
  await broker.handle(msg);
  assert.equal(broker.attemptState(operationId, attemptId), "confirmed");
});

test("an expired request (prepared more than 30 s ago) is denied before dispatch", async () => {
  const { root, broker, clock } = setup();
  const msg = writeMessage(broker, root, "e.txt", "late");
  clock.advance(30_000);
  const res = await broker.handle(msg);
  assert.equal(res.refusal, "permit_expired");
  assert.equal(fs.existsSync(path.join(root, "e.txt")), false);
});

test("changed arguments (argsDigest does not bind them) are denied before dispatch", async () => {
  const { root, broker } = setup();
  const msg = writeMessage(broker, root, "c.txt", "agreed");
  const res = await broker.handle({ ...msg, args: { contentBase64: Buffer.from("swapped").toString("base64") } });
  assert.equal(res.refusal, "request_changed");
  assert.equal(fs.existsSync(path.join(root, "c.txt")), false);
});

test("a changed request field after prepare (operation, contract, actor) is denied", async () => {
  const { root, broker } = setup();
  for (const change of [{ attemptId: "at-other" }, { acceptedContractDigest: "d".repeat(64) }, { actorIdentity: { harness: "claude-code", sessionId: "someone", taskId: "default" } }]) {
    const msg = writeMessage(broker, root, "x.txt", "x");
    const res = await broker.handle({ ...msg, request: { ...msg.request, ...change } });
    assert.equal(res.refusal, "request_changed", JSON.stringify(change));
  }
  assert.equal(fs.existsSync(path.join(root, "x.txt")), false);
});

test("a request naming another host cell is unsupported (capability_mismatch)", async () => {
  const { root, broker } = setup();
  const msg = writeMessage(broker, root, "h.txt", "x");
  const ev = { capabilityId: "ubuntu-26.04-x64/headless/workspace.write", level: "detection", probeDigest: null };
  const res = await broker.handle({ ...msg, request: { ...msg.request, capabilityEvidence: ev } });
  assert.equal(res.decision?.decision, "unsupported");
  assert.equal(res.refusal, "capability_mismatch");
  assert.equal(fs.existsSync(path.join(root, "h.txt")), false);
});

test("a changed resource refuses at dispatch: the parent's identity differs, nothing is written and no intent is journaled", async () => {
  const { root, broker, journalFile } = setup();
  fs.mkdirSync(path.join(root, "d"));
  const msg = writeMessage(broker, root, "d/a.txt", "x");
  const req = msg.request as { resourceIdentity: { parent: { identity: { inode: string } } } };
  req.resourceIdentity.parent.identity.inode = "1";
  const changed = { ...msg, request: buildAdmissionRequest(template(broker.prepare({ kind: "workspace.write" })), req.resourceIdentity, msg.args) };
  const res = await broker.handle(changed);
  assert.equal(res.state, "expired");
  assert.equal(res.refusal, "dispatch_check_failed");
  assert.equal(fs.existsSync(path.join(root, "d", "a.txt")), false);
  assert.deepEqual(journalTrail(journalFile), ["decision:allow", "effect:expired"]);
});

test("a write outside the work tree or into .git is denied by the broker's own scope", async () => {
  const { root, outside, broker } = setup();
  for (const target of [path.join(outside, "o.txt"), path.join(root, ".git", "config2")]) {
    const t = template(broker.prepare({ kind: "workspace.write" }));
    const args = { contentBase64: "eA==" };
    const resource = { path: target, parent: posixFileRef(path.dirname(target)), priorContentDigest: "absent" };
    const res = await broker.handle({ type: "dispatch", request: buildAdmissionRequest(t, resource, args), args });
    assert.equal(res.refusal, "policy_denied", target);
    assert.equal(fs.existsSync(target), false);
  }
});

test("a policy change between authorize and dispatch bumps the epoch: the pending permit refuses (authority_changed)", async () => {
  const { root, broker, policy } = setup();
  const msg = writeMessage(broker, root, "pc.txt", "x");
  const auth = broker.authorize(msg.request, msg.args);
  assert.equal(auth.kind, "pending");
  const epoch = broker.epoch;
  writePolicy(policy, [{ id: "extra", kind: "network.connect", effect: "deny" }]);
  const res = await broker.dispatch((auth as { pendingId: string }).pendingId);
  assert.ok(broker.epoch > epoch);
  assert.equal(res.refusal, "authority_changed");
  assert.equal(res.state, "expired");
  assert.equal(fs.existsSync(path.join(root, "pc.txt")), false);
});

test("revocation during a pending dispatch refuses it, and requests prepared before it are void", async () => {
  const { root, broker } = setup();
  const pendingMsg = writeMessage(broker, root, "rv1.txt", "x");
  const prepared = writeMessage(broker, root, "rv2.txt", "y");
  const auth = broker.authorize(pendingMsg.request, pendingMsg.args);
  broker.revoke();
  const res = await broker.dispatch((auth as { pendingId: string }).pendingId);
  assert.equal(res.refusal, "authority_changed");
  const later = await broker.handle(prepared);
  assert.equal(later.refusal, "permit_unknown");
  assert.equal(fs.existsSync(path.join(root, "rv1.txt")), false);
  assert.equal(fs.existsSync(path.join(root, "rv2.txt")), false);
});

test("a policy change between prepare and dispatch voids the prepared request (revocation)", async () => {
  const { root, broker, policy } = setup();
  const msg = writeMessage(broker, root, "pd.txt", "x");
  writePolicy(policy, [{ id: "extra", kind: "network.connect", effect: "deny" }]);
  const res = await broker.handle(msg);
  assert.equal(res.refusal, "permit_unknown", "the revocation voided the prepared nonce");
  assert.equal(fs.existsSync(path.join(root, "pd.txt")), false);
});

test("a malformed policy file denies everything (policy_invalid)", async () => {
  const { root, broker, policy } = setup();
  fs.writeFileSync(policy, "{not json");
  const res = broker.prepare({ kind: "workspace.write" });
  assert.equal(res.ok, false);
  assert.equal(res.refusal, "policy_invalid");
  assert.equal(fs.existsSync(path.join(root, "never.txt")), false);
});

test("a family without a dispatcher is unsupported, even when policy allows it", async () => {
  const { broker } = setup();
  const t = template(broker.prepare({ kind: "git.publish" }));
  const resource = { remoteUrl: "https://example.test/o/r.git", ref: "refs/heads/x", expectedOldHead: null, newHead: "a".repeat(40) };
  const res = await broker.handle({ type: "dispatch", request: buildAdmissionRequest(t, resource, {}), args: {} });
  assert.equal(res.decision?.decision, "unsupported");
  assert.equal(res.refusal, "capability_absent");
});

test("malformed messages get a deny, never a crash", async () => {
  const { broker } = setup();
  for (const m of [null, 42, [], { type: "nope" }, { type: "dispatch" }, { type: "dispatch", request: { schema: "x" }, args: {} }, { type: "prepare", kind: "rm -rf" }]) {
    const res = await broker.handle(m);
    assert.equal(res.ok, false, JSON.stringify(m));
    if (res.decision) assert.equal(res.decision.decision, "deny");
  }
});

test("symlink in the final component: a write through it refuses and the link target is untouched", { skip: false }, async () => {
  const { root, outside, broker } = setup();
  const target = path.join(outside, "victim.txt");
  fs.writeFileSync(target, "victim");
  fs.symlinkSync(target, path.join(root, "link.txt"));
  const t = template(broker.prepare({ kind: "workspace.write" }));
  const args = { contentBase64: Buffer.from("pwned").toString("base64") };
  for (const prior of ["absent", "0".repeat(64)]) {
    const resource = { path: path.join(root, "link.txt"), parent: posixFileRef(root), priorContentDigest: prior };
    const tt = prior === "absent" ? t : template(broker.prepare({ kind: "workspace.write" }));
    const res = await broker.handle({ type: "dispatch", request: buildAdmissionRequest(tt, resource, args), args });
    assert.equal(res.refusal, "dispatch_check_failed", prior);
    assert.match(res.detail ?? "", /symlink/);
  }
  assert.equal(fs.readFileSync(target, "utf8"), "victim");
});

test("a parent directory swapped for a symlink (or another directory) after authorize refuses at dispatch", async () => {
  const { root, outside, broker } = setup();
  for (const swap of ["symlink", "directory"] as const) {
    const dir = path.join(root, `p-${swap}`);
    fs.mkdirSync(dir);
    const msg = writeMessage(broker, root, `p-${swap}/a.txt`, "x");
    const auth = broker.authorize(msg.request, msg.args);
    assert.equal(auth.kind, "pending");
    fs.renameSync(dir, `${dir}.moved`);
    if (swap === "symlink") fs.symlinkSync(outside, dir);
    else fs.mkdirSync(dir);
    const res = await broker.dispatch((auth as { pendingId: string }).pendingId);
    assert.equal(res.refusal, "dispatch_check_failed", swap);
    assert.equal(fs.existsSync(path.join(outside, "a.txt")), false);
    assert.equal(fs.existsSync(path.join(dir, "a.txt")), false);
  }
});

test("modify: a stale prior content digest refuses; the current one replaces the file", async () => {
  const { root, broker } = setup();
  fs.writeFileSync(path.join(root, "m.txt"), "v1");
  const msg = writeMessage(broker, root, "m.txt", "v2");
  fs.writeFileSync(path.join(root, "m.txt"), "v1-changed");
  assert.equal((await broker.handle(msg)).refusal, "dispatch_check_failed");
  assert.equal(fs.readFileSync(path.join(root, "m.txt"), "utf8"), "v1-changed");
  const ok = await broker.handle(writeMessage(broker, root, "m.txt", "v2"));
  assert.equal(ok.state, "confirmed");
  assert.equal(fs.readFileSync(path.join(root, "m.txt"), "utf8"), "v2");
});

test("process.spawn runs the argv array without a shell, with only the environment it bound", async () => {
  const { root, broker } = setup();
  const res = await broker.handle(spawnMessage(broker, root, ["sh", "-c", 'printf "%s|%s" "$HOME" "$GANTRY_STATE_DIR" > out.txt'], { HOME: "/nowhere", PATH: "/usr/bin:/bin" }));
  assert.equal(res.state, "confirmed", JSON.stringify(res));
  assert.equal(res.result?.exitCode, 0);
  assert.equal(fs.readFileSync(path.join(root, "out.txt"), "utf8"), "/nowhere|", "nothing is inherited from the broker");
});

test("process.spawn: argv is never interpreted by a shell", async () => {
  const { root, broker } = setup();
  const res = await broker.handle(spawnMessage(broker, root, ["touch", "a; touch injected"]));
  assert.equal(res.state, "confirmed");
  assert.equal(fs.existsSync(path.join(root, "a; touch injected")), true);
  assert.equal(fs.existsSync(path.join(root, "injected")), false);
});

test("process.spawn: an environment name outside the allowlist is denied", async () => {
  const { root, broker } = setup();
  const res = await broker.handle(spawnMessage(broker, root, ["touch", "env.txt"], { PATH: "/usr/bin:/bin", AWS_SECRET_ACCESS_KEY: "x" }));
  assert.equal(res.refusal, "policy_denied");
  assert.deepEqual(res.decision?.policyRuleIds, ["broker-env-allowlist"]);
  assert.equal(fs.existsSync(path.join(root, "env.txt")), false);
});

test("process.spawn: a changed executable digest or a changed argv refuses before the process runs", async () => {
  const { root, broker } = setup();
  const msg = spawnMessage(broker, root, ["touch", "d1.txt"]);
  const req = msg.request as { resourceIdentity: Record<string, unknown> };
  const badDigest = { ...msg, request: buildAdmissionRequest(template(broker.prepare({ kind: "process.spawn" })), { ...req.resourceIdentity, executableDigest: "0".repeat(64) }, msg.args) };
  assert.equal((await broker.handle(badDigest)).refusal, "dispatch_check_failed");
  const swapped = { ...msg, args: { ...msg.args, argv: ["touch", "d2.txt"] } };
  assert.equal((await broker.handle(swapped)).refusal, "request_changed");
  assert.equal(fs.existsSync(path.join(root, "d1.txt")), false);
  assert.equal(fs.existsSync(path.join(root, "d2.txt")), false);
});

test("process.spawn: an executable path that is a symlink refuses (O_NOFOLLOW)", async () => {
  const { root, outside, broker } = setup();
  const real = fs.realpathSync("/bin/sh");
  const link = path.join(outside, "sh-link");
  fs.symlinkSync(real, link);
  const msg = spawnMessage(broker, root, ["sh", "-c", "touch ran.txt"]);
  const req = msg.request as { resourceIdentity: { executable: { path: string } } };
  const ri = { ...req.resourceIdentity, executable: { ...req.resourceIdentity.executable, path: link } };
  const res = await broker.handle({ ...msg, request: buildAdmissionRequest(template(broker.prepare({ kind: "process.spawn" })), ri, msg.args) });
  assert.equal(res.refusal, "dispatch_check_failed");
  assert.equal(fs.existsSync(path.join(root, "ran.txt")), false);
});

test("process.spawn: a timeout kills the process group and records unknown, never confirmed", async () => {
  const { root, broker, journalFile } = setup({ spawnTimeoutMs: 300 });
  const res = await broker.handle(spawnMessage(broker, root, ["sleep", "5"]));
  assert.equal(res.state, "unknown");
  assert.deepEqual(journalTrail(journalFile).slice(-2), ["effect:dispatch-intent", "effect:unknown"]);
});

test("journal write failure refuses the dispatch: nothing is written", { skip: isRoot ? "root ignores directory permissions" : false }, async () => {
  const { root, broker, journalFile } = setup();
  const msg = writeMessage(broker, root, "j.txt", "x");
  fs.chmodSync(path.dirname(journalFile), 0o500);
  try {
    const res = await broker.handle(msg);
    assert.equal(res.state, "not-dispatched");
    assert.equal(res.refusal, "journal_unavailable");
  } finally {
    fs.chmodSync(path.dirname(journalFile), 0o700);
  }
  assert.equal(fs.existsSync(path.join(root, "j.txt")), false);
});

test("a full journal refuses new dispatches and drops no record", async () => {
  const { root, broker, journalFile, journal } = setup({ maxBytes: 4096 });
  const results = [];
  for (let i = 0; i < 6; i += 1) results.push(await broker.handle(writeMessage(broker, root, `full-${i}.txt`, "x")));
  const refused = results.filter((r) => r.refusal === "journal_full");
  assert.ok(refused.length > 0, "the cap was reached");
  assert.ok(results[0]!.ok, "the first dispatch fit");
  const trail = journalTrail(journalFile);
  assert.equal(trail.filter((t) => t === "effect:dispatch-intent").length, trail.filter((t) => t === "effect:confirmed").length, "every started dispatch has its outcome");
  assert.equal(journal.anchor.count, trail.length);
  for (const [i, r] of results.entries()) assert.equal(fs.existsSync(path.join(root, `full-${i}.txt`)), r.ok);
});

test("a journal changed outside the broker refuses every later dispatch", async () => {
  const { root, broker, journalFile } = setup();
  await broker.handle(writeMessage(broker, root, "ok.txt", "x"));
  fs.appendFileSync(journalFile, "garbage\n");
  const res = await broker.handle(writeMessage(broker, root, "no.txt", "x"));
  assert.equal(res.ok, false);
  assert.equal(fs.existsSync(path.join(root, "no.txt")), false);
  const res2 = await broker.handle(writeMessage(broker, root, "no2.txt", "x"));
  assert.equal(res2.refusal, "journal_full", "a broken journal admits no new dispatch");
});

test("crash after intent: a restart records unknown, never re-dispatches, and blocks a new attempt for the operation", async () => {
  const { root, outside, policy, broker } = setup({ spawnTimeoutMs: 20_000 });
  const pidFile = path.join(outside, "pid");
  const log = path.join(root, "runs.log");
  const msg = spawnMessage(broker, root, ["sh", "-c", `echo run >> runs.log; echo $$ > ${pidFile}; exec sleep 15`]);
  // handle() journals decision and intent synchronously, then awaits the process: abandon it there (the "crash").
  const inflight = broker.handle(msg);
  const { operationId, attemptId } = msg.request as { operationId: string; attemptId: string };
  for (let i = 0; i < 100 && !fs.existsSync(pidFile); i += 1) await new Promise((r) => setTimeout(r, 20));
  const second = openBroker(root, policy);
  assert.equal(second.broker.attemptState(operationId, attemptId), "unknown");
  assert.deepEqual(journalTrail(second.journalFile), ["decision:allow", "effect:dispatch-intent", "effect:unknown"]);
  const replay = await second.broker.handle(msg);
  assert.equal(replay.refusal, "permit_unknown");
  assert.equal(second.broker.attemptState(operationId, attemptId), "unknown", "the refused replay left the unknown in place");
  const retry = second.broker.prepare({ kind: "process.spawn", operationId });
  assert.equal(retry.ok, false, "an unknown operation gets no new attempt until reconciled");
  process.kill(Number(fs.readFileSync(pidFile, "utf8").trim()), "SIGKILL");
  const late = await inflight;
  assert.notEqual(late.state, "confirmed", "the abandoned broker cannot journal over its successor");
  assert.equal(fs.readFileSync(log, "utf8"), "run\n", "the process ran once");
});

test("the capability view reports this host's cells verbatim and none is prevention", () => {
  const { broker } = setup();
  const view = broker.capabilityView();
  assert.equal(view.capabilities?.rows.length, 7);
  assert.equal(view.capabilities?.rows.some((r) => r.level === "prevention"), false);
  assert.deepEqual(view.capabilities?.dispatched, ["workspace.write", "process.spawn"]);
});

test("the request a client builds binds the accepted contract the broker was started with", () => {
  const { broker } = setup();
  assert.equal(template(broker.prepare({ kind: "workspace.write" })).acceptedContractDigest, CONTRACT_DIGEST);
});

// --- review round (PR #370) ---------------------------------------------------------------------------------------

test("a forged request's client-chosen operation id is never registered: prepare refuses it, also after a restart", async () => {
  const { root, policy, broker, journalFile } = setup();
  const msg = writeMessage(broker, root, "g.txt", "x");
  const chosen = `op-${"ab".repeat(12)}`;
  const forged = { ...msg, request: { ...msg.request, nonce: "e".repeat(32), operationId: chosen, attemptId: `at-${"cd".repeat(12)}` } };
  const res = await broker.handle(forged);
  assert.equal(res.refusal, "permit_unknown");
  assert.deepEqual(journalTrail(journalFile), ["decision:deny"], "the refusal is journaled as a counted refusal");
  assert.equal(broker.attemptState(chosen, `at-${"cd".repeat(12)}`), undefined);
  const prep = broker.prepare({ kind: "workspace.write", operationId: chosen });
  assert.equal(prep.ok, false);
  assert.equal(prep.refusal, "permit_unknown");
  const restarted = openBroker(root, policy);
  assert.equal(restarted.broker.prepare({ kind: "workspace.write", operationId: chosen }).ok, false, "recovery skips refusals of ids the broker never issued");
});

test("a request whose ids differ from the prepared ones registers neither set of ids", async () => {
  const { root, broker } = setup();
  const msg = writeMessage(broker, root, "h.txt", "x");
  const chosen = `op-${"ef".repeat(12)}`;
  const res = await broker.handle({ ...msg, request: { ...msg.request, operationId: chosen } });
  assert.equal(res.refusal, "request_changed");
  assert.equal(broker.prepare({ kind: "workspace.write", operationId: chosen }).ok, false);
});

test("prepare accepts only an operation id the broker issued", async () => {
  const { root, broker } = setup();
  const msg = writeMessage(broker, root, "i.txt", "x");
  assert.equal((await broker.handle(msg)).state, "confirmed");
  const { operationId } = msg.request as { operationId: string };
  assert.equal(broker.prepare({ kind: "workspace.write", operationId }).ok, true, "a terminal operation the broker issued may get a new attempt");
  for (const bad of ["op-1", "x".repeat(40), 7]) assert.equal(broker.prepare({ kind: "workspace.write", operationId: bad }).ok, false);
});

test("the attempt table is bounded; an unknown operation is never forgotten", async () => {
  const { root, broker } = setup({ maxTrackedAttempts: 3, spawnTimeoutMs: 200 });
  const slow = spawnMessage(broker, root, ["sleep", "5"]);
  assert.equal((await broker.handle(slow)).state, "unknown");
  const { operationId, attemptId } = slow.request as { operationId: string; attemptId: string };
  for (let i = 0; i < 6; i += 1) assert.equal((await broker.handle(writeMessage(broker, root, `b${i}.txt`, "x"))).state, "confirmed");
  assert.ok(broker.trackedAttempts <= 3, String(broker.trackedAttempts));
  assert.equal(broker.attemptState(operationId, attemptId), "unknown");
  assert.equal(broker.prepare({ kind: "process.spawn", operationId }).ok, false, "still blocked until reconciled");
});

test("denial budget: refusals are journaled until it is spent, then new requests get a fixed unjournaled refusal while an authorized dispatch completes", async () => {
  const { root, broker, journal, journalFile } = setup({ denialMaxBytes: 4000, spawnTimeoutMs: 20_000 });
  const inflight = broker.handle(spawnMessage(broker, root, ["sh", "-c", "sleep 1; echo done > done.txt"]));
  let refused: Awaited<ReturnType<typeof broker.handle>> | null = null;
  for (let i = 0; i < 50 && refused === null; i += 1) {
    const msg = writeMessage(broker, root, `d${i}.txt`, "x");
    const res = await broker.handle({ ...msg, request: { ...msg.request, nonce: `${i}`.padStart(32, "0") } });
    if (res.refusal === "denial_budget_exhausted") refused = res;
    else assert.equal(res.refusal, "permit_unknown");
  }
  assert.ok(refused !== null, "the denial budget ran out");
  assert.equal(refused.receipts?.length, 0);
  assert.equal(broker.denialBudgetExhausted, true);
  const size = fs.statSync(journalFile).size;
  for (const m of [{ type: "capabilities" }, { type: "prepare", kind: "workspace.write" }, { type: "dispatch", request: null, args: null }]) {
    assert.equal((await broker.handle(m)).refusal, "denial_budget_exhausted");
  }
  assert.equal(fs.statSync(journalFile).size, size, "nothing is journaled once the budget is spent");
  const done = await inflight;
  assert.equal(done.state, "confirmed", JSON.stringify(done));
  assert.equal(fs.readFileSync(path.join(root, "done.txt"), "utf8"), "done\n");
  assert.ok(journal.budgets.denialBytes <= 4000);
  assert.deepEqual(journalTrail(journalFile).filter((t) => t.startsWith("effect:")), ["effect:dispatch-intent", "effect:confirmed"], "the in-flight dispatch kept its intent and outcome");
});

/** A write request and its check, built through the broker's own prepare (the request is never dispatched by it). */
function writeCheck(broker: ReturnType<typeof setup>["broker"], root: string, rel: string, content: string, io?: WriteIo): DispatchCheck {
  const msg = writeMessage(broker, root, rel, content);
  return checkWorkspaceWrite(msg.request as never, brokerArgsSchemas["workspace.write"].parse(msg.args), io);
}

const failingFsync = (failAt: number): WriteIo => {
  let n = 0;
  return {
    writeSync: (fd, buf, off, len) => fs.writeSync(fd, buf, off, len),
    fsyncSync: (fd) => {
      n += 1;
      if (n === failAt) throw Object.assign(new Error("fsync failed"), { code: "EIO" });
      fs.fsyncSync(fd);
    },
  };
};

test("workspace.write: an error after the file was created (directory fsync) is unknown with an ambiguity marker, never failed", async () => {
  const { root, broker } = setup();
  const check = writeCheck(broker, root, "u.txt", "hello", failingFsync(2));
  assert.equal(check.ok, true);
  if (!check.ok) return;
  const out = await check.run();
  check.release();
  assert.equal(out.state, "unknown");
  assert.equal(out.ambiguity, "lost-acknowledgement");
  assert.equal(fs.existsSync(path.join(root, "u.txt")), true, "the file was mutated");
});

test("workspace.write: an error after the replacing rename is unknown; one before it is failed and leaves the target as it was", async () => {
  const { root, broker } = setup();
  fs.writeFileSync(path.join(root, "v.txt"), "v1");
  // fsync 1 is the temporary file, 2 the directory after the rename.
  const after = writeCheck(broker, root, "v.txt", "v2", failingFsync(2));
  assert.equal(after.ok && (await after.run()).state, "unknown");
  if (after.ok) after.release();
  assert.equal(fs.readFileSync(path.join(root, "v.txt"), "utf8"), "v2");
  const before = writeCheck(broker, root, "v.txt", "v3", failingFsync(1));
  assert.equal(before.ok && (await before.run()).state, "failed");
  if (before.ok) before.release();
  assert.equal(fs.readFileSync(path.join(root, "v.txt"), "utf8"), "v2", "nothing changed before the rename");
  assert.deepEqual(fs.readdirSync(root).filter((n) => n.includes(".og-")), [], "the temporary file was removed");
});

test("workspace.write: a short write while creating the file is unknown (the file exists, partly written)", async () => {
  const { root, broker } = setup();
  const io: WriteIo = { writeSync: (fd, buf, off) => fs.writeSync(fd, buf, off, 1) && 0, fsyncSync: (fd) => fs.fsyncSync(fd) };
  const check = writeCheck(broker, root, "w.txt", "hello", io);
  assert.equal(check.ok && (await check.run()).state, "unknown");
  if (check.ok) check.release();
});

test("workspace.write: an error before any mutation (the create is refused) is failed", { skip: isRoot ? "root ignores directory permissions" : false }, async () => {
  const { root, broker } = setup();
  const dir = path.join(root, "ro");
  fs.mkdirSync(dir);
  const check = writeCheck(broker, root, "ro/x.txt", "x");
  fs.chmodSync(dir, 0o555);
  try {
    assert.equal(check.ok && (await check.run()).state, "failed");
  } finally {
    if (check.ok) check.release();
    fs.chmodSync(dir, 0o755);
  }
  assert.equal(fs.existsSync(path.join(dir, "x.txt")), false);
});

test("workspace.write: a target rewritten in place (same inode) after the check is not replaced", async () => {
  const { root, broker } = setup();
  const target = path.join(root, "same.txt");
  fs.writeFileSync(target, "v1");
  const check = writeCheck(broker, root, "same.txt", "v2");
  assert.equal(check.ok, true);
  if (!check.ok) return;
  const ino = fs.statSync(target).ino;
  fs.writeFileSync(target, "v1-rewritten");
  assert.equal(fs.statSync(target).ino, ino, "same inode");
  const out = await check.run();
  check.release();
  assert.equal(out.state, "failed");
  assert.equal(fs.readFileSync(target, "utf8"), "v1-rewritten");
});

test("process.spawn: an executable rewritten in place after the check runs the verified bytes, from a broker-private copy", async () => {
  const { root, outside, broker } = setup();
  const tool = path.join(outside, "tool.sh");
  fs.writeFileSync(tool, '#!/bin/sh\necho ORIGINAL > "$1"\n', { mode: 0o755 });
  const msg = spawnMessage(broker, root, [tool, "out.txt"]);
  const privateDir = fs.mkdtempSync(path.join(os.tmpdir(), "og-private-"));
  const check = checkProcessSpawn(msg.request as never, brokerArgsSchemas["process.spawn"].parse(msg.args), 5000, privateDir);
  assert.equal(check.ok, true, check.ok ? "" : check.detail);
  if (!check.ok) return;
  fs.writeFileSync(tool, '#!/bin/sh\necho EVIL > "$1"\n');
  const out = await check.run();
  check.release();
  assert.equal(out.state, "confirmed", out.detail);
  assert.equal(fs.readFileSync(path.join(root, "out.txt"), "utf8"), "ORIGINAL\n");
  assert.deepEqual(fs.readdirSync(privateDir), [], "the private copy is deleted afterwards");
});

test("process.spawn: a private directory that is not 0700 and ours refuses before anything runs", async () => {
  const { root, broker } = setup();
  const msg = spawnMessage(broker, root, ["touch", "never.txt"]);
  const privateDir = fs.mkdtempSync(path.join(os.tmpdir(), "og-private-"));
  fs.chmodSync(privateDir, 0o755);
  const check = checkProcessSpawn(msg.request as never, brokerArgsSchemas["process.spawn"].parse(msg.args), 5000, privateDir);
  assert.equal(check.ok, false);
  assert.match(check.ok ? "" : check.detail, /mode 0700/);
});

// --- review round 2 (PR #370) ---------------------------------------------------------------------------------------

test("policy checks on every reload: a policy made group writable after start is policy_invalid, and a pending permit refuses", async () => {
  const { root, broker, policy } = setup();
  const msg = writeMessage(broker, root, "gw.txt", "x");
  const auth = broker.authorize(msg.request, msg.args);
  assert.equal(auth.kind, "pending");
  const epoch = broker.epoch;
  fs.chmodSync(policy, 0o664);
  const res = await broker.dispatch((auth as { pendingId: string }).pendingId);
  assert.ok(broker.epoch > epoch, "the epoch was bumped");
  assert.equal(res.refusal, "authority_changed");
  assert.equal(fs.existsSync(path.join(root, "gw.txt")), false);
  const prep = broker.prepare({ kind: "workspace.write" });
  assert.equal(prep.refusal, "policy_invalid");
  assert.match(prep.detail ?? "", /group or world writable/);
  // Fixed: the policy decides again.
  fs.chmodSync(policy, 0o600);
  assert.equal(broker.prepare({ kind: "workspace.write" }).ok, true);
});

test("policy checks on every reload: a group- or world-writable policy directory is policy_invalid", () => {
  const { broker, policy } = setup();
  const dir = path.dirname(policy);
  const mode = fs.statSync(dir).mode & 0o777;
  fs.chmodSync(dir, 0o777);
  try {
    const prep = broker.prepare({ kind: "workspace.write" });
    assert.equal(prep.refusal, "policy_invalid");
    assert.match(prep.detail ?? "", /directory .* group or world writable/);
  } finally {
    fs.chmodSync(dir, mode);
  }
  assert.equal(broker.prepare({ kind: "workspace.write" }).ok, true);
});

test("policy checks on every reload: a policy replaced by a symlink is policy_invalid", () => {
  const { outside, broker, policy } = setup();
  const real = writePolicy(path.join(outside, "real-policy.json"));
  fs.rmSync(policy);
  fs.symlinkSync(real, policy);
  assert.equal(broker.prepare({ kind: "workspace.write" }).refusal, "policy_invalid");
});

test("an authorized dispatch's intent may use the outcome reserve: it is not refused at the dispatch cap", async () => {
  // Measure the allow decision record with a roomy journal, then cap the dispatch budget just above it.
  const probe = setup();
  await probe.broker.handle(writeMessage(probe.broker, probe.root, "probe.txt", "x"));
  const decisionBytes = Buffer.byteLength(fs.readFileSync(probe.journalFile, "utf8").split("\n")[0]!) + 1;
  const { root, broker, journal, journalFile } = setup({ maxBytes: decisionBytes + 16 });
  const res = await broker.handle(writeMessage(broker, root, "r.txt", "y"));
  assert.equal(res.state, "confirmed", JSON.stringify(res).slice(0, 300));
  assert.deepEqual(journalTrail(journalFile), ["decision:allow", "effect:dispatch-intent", "effect:confirmed"]);
  assert.ok(journal.budgets.dispatchBytes > decisionBytes + 16, "intent and outcome went into the reserve");
  // The cap still refuses the next new dispatch.
  const next = await broker.handle(writeMessage(broker, root, "s.txt", "z"));
  assert.equal(next.refusal, "journal_full");
  assert.equal(fs.existsSync(path.join(root, "s.txt")), false);
});

test("workspace.write: a failed rename removes its temporary file", async () => {
  const { root, broker } = setup();
  fs.writeFileSync(path.join(root, "t.txt"), "t1");
  const io: WriteIo = {
    writeSync: (fd, buf, off, len) => fs.writeSync(fd, buf, off, len),
    fsyncSync: (fd) => fs.fsyncSync(fd),
    renameSync: () => {
      throw Object.assign(new Error("rename failed"), { code: "EIO" });
    },
  };
  const check = writeCheck(broker, root, "t.txt", "t2", io);
  assert.equal(check.ok, true);
  if (!check.ok) return;
  const out = await check.run();
  check.release();
  assert.equal(out.state, "unknown");
  assert.equal(fs.readFileSync(path.join(root, "t.txt"), "utf8"), "t1");
  assert.deepEqual(fs.readdirSync(root).filter((n) => n.includes(".og-")), [], "the temporary file was removed");
});
