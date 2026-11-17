/**
 * `gantry admission serve` as a real process (issue #356 slice 3): untrusted socket input, concurrent clients in separate
 * processes, and a broker killed between the dispatch intent and the outcome (ADM-T04).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { getRepoRoot, gitChildEnv } from "#git/git.js";
import type { BrokerResponse, RequestTemplate } from "#missions/admission/broker.js";
import { buildAdmissionRequest, posixFileRef, sendBrokerMessage, sendBrokerRaw, sha256File } from "#missions/admission/client.js";
import { environmentNamesDigest } from "#missions/admission/dispatch.js";
import { admissionJournalPath } from "#missions/admission/journal-file.js";
import { startBroker } from "#missions/admission/serve.js";
import { CONTRACT_DIGEST, brokerRepo, journalTrail, resolveExecutable, writePolicy } from "./fixtures.js";

const OG = getRepoRoot();
const CLI = path.join(OG, "dist", "cli", "index.js");
const CLIENT = path.join(OG, "dist", "packages", "missions", "src", "admission", "client.js");

/** A short socket dir (sun_path is 108 bytes), 0700. */
function socketDir(): string {
  const base = Buffer.byteLength(os.tmpdir()) < 60 ? os.tmpdir() : "/tmp";
  return fs.mkdtempSync(path.join(base, "og-sock-"));
}

interface Fixture {
  root: string;
  outside: string;
  policy: string;
  socket: string;
  stateDir: string;
  env: NodeJS.ProcessEnv;
}

function fixture(): Fixture {
  const { root, outside } = brokerRepo();
  const policy = writePolicy(path.join(outside, "policy.json"));
  const stateDir = path.join(outside, "state");
  const env = gitChildEnv({ GANTRY_STATE_DIR: stateDir });
  return { root, outside, policy, socket: path.join(socketDir(), "b.sock"), stateDir, env };
}

function serveArgs(f: Fixture, extra: string[] = []): string[] {
  return [CLI, "admission", "serve", "--harness", "claude-code", "--contract-digest", CONTRACT_DIGEST, "--policy", f.policy, "--socket", f.socket, "--assume-platform", "ubuntu-26.04-x64", ...extra];
}

async function serve(f: Fixture): Promise<ChildProcess> {
  const child = spawn(process.execPath, serveArgs(f), { cwd: f.root, env: f.env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stderr!.on("data", (b: Buffer) => (err += b.toString()));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`broker did not start: ${out} ${err}`)), 15_000);
    child.stdout!.on("data", (b: Buffer) => {
      out += b.toString();
      if (out.includes("listening on")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`broker exited ${code}: ${out} ${err}`));
    });
  });
  child.removeAllListeners("exit");
  return child;
}

function stop(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve(child.exitCode);
    child.once("exit", (code) => resolve(code));
    child.kill("SIGTERM");
  });
}

async function prepare(socket: string, kind: string, operationId?: string): Promise<BrokerResponse> {
  return (await sendBrokerMessage(socket, { type: "prepare", kind, ...(operationId ? { operationId } : {}) })) as BrokerResponse;
}

async function spawnDispatch(socket: string, cwd: string, argv: string[]): Promise<{ type: "dispatch"; request: Record<string, unknown>; args: unknown }> {
  const res = await prepare(socket, "process.spawn");
  assert.equal(res.ok, true, JSON.stringify(res));
  const env = { PATH: "/usr/bin:/bin" };
  const exe = posixFileRef(resolveExecutable(argv[0]!));
  const args = { argv, env };
  const resource = { executable: exe, executableDigest: sha256File(exe.path), cwd: posixFileRef(cwd), environmentAllowlistDigest: environmentNamesDigest(env) };
  return { type: "dispatch", request: buildAdmissionRequest(res.template as RequestTemplate, resource, args), args };
}

test("socket: malformed, oversized and multi-message input gets a deny and the broker keeps serving", async () => {
  const f = fixture();
  const child = await serve(f);
  try {
    assert.equal((fs.statSync(f.socket).mode & 0o777).toString(8), "600");
    const answers = [
      await sendBrokerRaw(f.socket, "not json\n"),
      await sendBrokerRaw(f.socket, Buffer.alloc(2 * 1024 * 1024, 0x61)),
      await sendBrokerRaw(f.socket, '{"type":"capabilities"}\n{"type":"capabilities"}\n'),
      await sendBrokerRaw(f.socket, `${JSON.stringify({ type: "dispatch", request: { schema: "opengantry.admission-request.v1", pad: "x".repeat(70 * 1024) }, args: {} })}\n`),
      await sendBrokerRaw(f.socket, '{"type":"dispatch","request":null,"args":null}\n'),
    ];
    for (const raw of answers) {
      const res = JSON.parse(raw) as BrokerResponse;
      assert.equal(res.ok, false, raw.slice(0, 200));
      assert.equal(res.refusal, "request_malformed");
      assert.equal(res.decision?.decision, "deny");
    }
    const caps = (await sendBrokerMessage(f.socket, { type: "capabilities" })) as BrokerResponse;
    assert.equal(caps.ok, true, "still serving");
    assert.equal(caps.capabilities?.rows.some((r) => r.level === "prevention"), false);
  } finally {
    assert.equal(await stop(child), 0);
  }
  assert.equal(fs.existsSync(f.socket), false, "a clean stop removes the socket");
});

test("concurrent dispatch of one attempt from separate client processes produces exactly one effect", async () => {
  const f = fixture();
  const child = await serve(f);
  try {
    const msg = await spawnDispatch(f.socket, f.root, ["sh", "-c", "echo x >> count.log"]);
    const msgFile = path.join(f.outside, "msg.json");
    fs.writeFileSync(msgFile, JSON.stringify(msg));
    const script = `import { readFileSync } from "node:fs";
import { sendBrokerMessage } from ${JSON.stringify(new URL(`file://${CLIENT}`).href)};
const m = JSON.parse(readFileSync(process.argv[2], "utf8"));
process.stdout.write(JSON.stringify(await sendBrokerMessage(process.argv[1], m)));`;
    const clients = Array.from({ length: 8 }, () =>
      new Promise<BrokerResponse>((resolve, reject) => {
        const c = spawn(process.execPath, ["--input-type=module", "-e", script, f.socket, msgFile], { cwd: OG, stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        c.stdout.on("data", (b: Buffer) => (out += b.toString()));
        c.on("exit", (code) => (code === 0 ? resolve(JSON.parse(out) as BrokerResponse) : reject(new Error(`client exited ${code}`))));
      }),
    );
    const results = await Promise.all(clients);
    assert.equal(results.filter((r) => r.state === "confirmed").length, 1, JSON.stringify(results.map((r) => r.refusal ?? r.state)));
    assert.equal(results.filter((r) => r.refusal === "permit_reused").length, 7);
    assert.equal(fs.readFileSync(path.join(f.root, "count.log"), "utf8"), "x\n", "the process ran exactly once");
  } finally {
    await stop(child);
  }
});

test("crash between intent and outcome: after kill -9 a restart records unknown and never re-dispatches", async () => {
  const f = fixture();
  let child = await serve(f);
  const pidFile = path.join(f.outside, "pid");
  const msg = await spawnDispatch(f.socket, f.root, ["sh", "-c", `echo run >> runs.log; echo $$ > ${pidFile}; exec sleep 30`]);
  const { operationId } = msg.request as { operationId: string };
  sendBrokerMessage(f.socket, msg).catch(() => undefined);
  for (let i = 0; i < 200 && !fs.existsSync(pidFile); i += 1) await new Promise((r) => setTimeout(r, 25));
  child.kill("SIGKILL");
  await new Promise((r) => child.once("exit", r));
  process.kill(Number(fs.readFileSync(pidFile, "utf8").trim()), "SIGKILL");
  const journalFile = admissionJournalPath(f.root)!;
  assert.deepEqual(journalTrail(journalFile), ["decision:allow", "effect:dispatch-intent"], "the intent was durable before the effect");

  // No stale takeover: the crashed broker's lock and socket refuse a restart until the operator removes them.
  const refused = spawnSync(process.execPath, serveArgs(f), { cwd: f.root, env: f.env, encoding: "utf8" });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /GXT_ADMISSION_BROKER_LOCKED|another admission broker/);
  const stateDir = fs.readdirSync(path.join(f.stateDir, "admission")).map((d) => path.join(f.stateDir, "admission", d))[0]!;
  fs.rmSync(path.join(stateDir, "broker.lock"));
  fs.rmSync(f.socket);

  child = await serve(f);
  try {
    assert.deepEqual(journalTrail(journalFile), ["decision:allow", "effect:dispatch-intent", "effect:unknown"]);
    const replay = (await sendBrokerMessage(f.socket, msg)) as BrokerResponse;
    assert.equal(replay.refusal, "permit_unknown");
    const retry = await prepare(f.socket, "process.spawn", operationId);
    assert.equal(retry.ok, false, "an unknown operation gets no new attempt until reconciled");
    assert.equal(fs.readFileSync(path.join(f.root, "runs.log"), "utf8"), "run\n", "the process ran once");
  } finally {
    await stop(child);
  }
});

test("serve refuses a policy or socket inside the work tree, a bad contract digest and a second broker", async () => {
  const f = fixture();
  const run = (args: string[]) => spawnSync(process.execPath, args, { cwd: f.root, env: f.env, encoding: "utf8" });
  fs.copyFileSync(f.policy, path.join(f.root, "policy.json"));
  const inTree = run(serveArgs({ ...f, policy: path.join(f.root, "policy.json") }));
  assert.equal(inTree.status, 2);
  assert.match(inTree.stderr, /GXT_ADMISSION_BROKER_CONFIG_INVALID|inside the work tree/);
  const sockInTree = run(serveArgs({ ...f, socket: path.join(f.root, "b.sock") }));
  assert.equal(sockInTree.status, 2);
  assert.match(sockInTree.stderr, /socket must not be inside the work tree/);
  const badDigest = run([CLI, "admission", "serve", "--harness", "claude-code", "--contract-digest", "nope", "--policy", f.policy, "--socket", f.socket, "--assume-platform", "ubuntu-26.04-x64"]);
  assert.equal(badDigest.status, 2);
  const child = await serve(f);
  try {
    const second = run(serveArgs(f));
    assert.equal(second.status, 1);
    assert.match(second.stderr, /another admission broker/);
  } finally {
    await stop(child);
  }
});

test("stop sends SIGTERM to the recorded broker, which removes its socket and lock", async () => {
  const f = fixture();
  const child = await serve(f);
  const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
  const r = spawnSync(process.execPath, [CLI, "admission", "stop", "--json"], { cwd: f.root, env: f.env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal((JSON.parse(r.stdout) as { status: string }).status, "stopping");
  assert.equal(await exited, 0);
  assert.equal(fs.existsSync(f.socket), false);
  const again = spawnSync(process.execPath, [CLI, "admission", "stop"], { cwd: f.root, env: f.env, encoding: "utf8" });
  assert.equal(again.status, 1);
  assert.match(again.stderr, /no admission broker/);
});

test("stop never signals a process that is not an admission broker (a recycled pid in broker.json)", async () => {
  const f = fixture();
  const child = await serve(f);
  await stop(child);
  const bystander = spawn("sleep", ["30"], { stdio: "ignore" });
  try {
    const stateDir = fs.readdirSync(path.join(f.stateDir, "admission")).map((d) => path.join(f.stateDir, "admission", d))[0]!;
    fs.writeFileSync(path.join(stateDir, "broker.json"), `${JSON.stringify({ pid: bystander.pid, socket: f.socket })}\n`);
    const r = spawnSync(process.execPath, [CLI, "admission", "stop"], { cwd: f.root, env: f.env, encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not running/);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(bystander.exitCode, null);
    assert.equal(bystander.signalCode, null, "the bystander was not signalled");
  } finally {
    bystander.kill("SIGKILL");
  }
});

// --- review round (PR #370) ---------------------------------------------------------------------------------------

test("a spawn that runs longer than the 10 s connection timeout gets its true result, not a timeout deny", { timeout: 60_000 }, async () => {
  const f = fixture();
  const child = await serve(f);
  try {
    const msg = await spawnDispatch(f.socket, f.root, ["sh", "-c", "sleep 11; echo slept > slept.txt"]);
    const res = (await sendBrokerMessage(f.socket, msg, 45_000)) as BrokerResponse;
    assert.equal(res.state, "confirmed", JSON.stringify(res).slice(0, 300));
    assert.equal(res.refusal, null);
    assert.equal(fs.readFileSync(path.join(f.root, "slept.txt"), "utf8"), "slept\n");
    assert.deepEqual(journalTrail(admissionJournalPath(f.root)!), ["decision:allow", "effect:dispatch-intent", "effect:confirmed"]);
  } finally {
    await stop(child);
  }
});

/** Send a valid line, then (once the broker has started on it) more bytes than a message may hold, and read the answer. */
function sendWithTrailingGarbage(socket: string, line: string, garbage: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const sock = net.createConnection(socket);
    sock.on("connect", () => {
      sock.write(line);
      setTimeout(() => sock.end(garbage), 300);
    });
    sock.on("data", (c: Buffer) => chunks.push(c));
    sock.on("error", (err) => (chunks.length > 0 ? undefined : reject(err)));
    sock.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

test("bytes after a valid line (even past the message bound) are dropped: the only answer is the broker's", async () => {
  const f = fixture();
  const child = await serve(f);
  try {
    const msg = await spawnDispatch(f.socket, f.root, ["sh", "-c", "sleep 1; echo ran >> ran.log"]);
    const raw = await sendWithTrailingGarbage(f.socket, `${JSON.stringify(msg)}\n`, Buffer.alloc(2 * 1024 * 1024, 0x7a));
    const lines = raw.split("\n").filter(Boolean);
    assert.equal(lines.length, 1, raw.slice(0, 300));
    const res = JSON.parse(lines[0]!) as BrokerResponse;
    assert.equal(res.state, "confirmed", lines[0]!.slice(0, 300));
    assert.equal(fs.readFileSync(path.join(f.root, "ran.log"), "utf8"), "ran\n");
  } finally {
    await stop(child);
  }
});

function inProcessOptions(f: Fixture, extra: Record<string, unknown> = {}) {
  return { root: f.root, harness: "claude-code", contractDigest: CONTRACT_DIGEST, policy: f.policy, socket: f.socket, assumePlatform: "ubuntu-26.04-x64", env: f.env, ...extra };
}

test("a flood of malformed and oversized input is counted per window, not journaled per message", async () => {
  const f = fixture();
  const running = await startBroker(inProcessOptions(f, { summaryWindowMs: 60_000 }));
  const journalFile = admissionJournalPath(f.root)!;
  const sizeBefore = fs.existsSync(journalFile) ? fs.statSync(journalFile).size : 0;
  try {
    const sends: Promise<string>[] = [];
    for (let i = 0; i < 150; i += 1) sends.push(sendBrokerRaw(f.socket, i % 3 === 0 ? "{not json\n" : i % 3 === 1 ? '{"type":"dispatch","request":{"x":1},"args":null}\n' : "[]\n"));
    for (let i = 0; i < 3; i += 1) sends.push(sendBrokerRaw(f.socket, Buffer.alloc(BROKER_MAX + 10, 0x61)));
    for (const raw of await Promise.all(sends)) assert.equal((JSON.parse(raw) as BrokerResponse).refusal, "request_malformed");
  } finally {
    await running.close();
  }
  assert.equal(fs.existsSync(journalFile) ? fs.statSync(journalFile).size : 0, sizeBefore, "no journal growth");
  const summaryFile = path.join(path.dirname(journalFile), "input-summary.jsonl");
  const lines = fs.readFileSync(summaryFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { schema: string; counts: Record<string, number> });
  assert.equal(lines.length, 1, "one summary line for the window");
  assert.equal(lines[0]!.schema, "opengantry.admission-input-summary.v1");
  assert.deepEqual(lines[0]!.counts, { malformed: 150, oversized: 3, timed_out: 0, denial_budget_exhausted: 0 });
});

const BROKER_MAX = 1024 * 1024 + 64 * 1024;

test("denial budget over the socket: once spent, new connections get a fixed refusal and an authorized dispatch in flight completes", async () => {
  const f = fixture();
  const running = await startBroker(inProcessOptions(f, { journalDenialMaxBytes: 4000 }));
  const journalFile = admissionJournalPath(f.root)!;
  try {
    const slow = await spawnDispatch(f.socket, f.root, ["sh", "-c", "sleep 1.5; echo done > done.txt"]);
    const inflight = sendBrokerMessage(f.socket, slow) as Promise<BrokerResponse>;
    await new Promise((r) => setTimeout(r, 200));
    let exhausted = false;
    for (let i = 0; i < 50 && !exhausted; i += 1) {
      const msg = await spawnDispatch(f.socket, f.root, ["true"]).catch(() => null);
      if (msg === null) break;
      const res = (await sendBrokerMessage(f.socket, { ...msg, request: { ...msg.request, nonce: `${i}`.padStart(32, "0") } })) as BrokerResponse;
      exhausted = res.refusal === "denial_budget_exhausted";
    }
    const size = fs.statSync(journalFile).size;
    const refused = (await sendBrokerMessage(f.socket, { type: "capabilities" })) as BrokerResponse;
    assert.equal(refused.refusal, "denial_budget_exhausted");
    assert.equal((JSON.parse(await sendBrokerRaw(f.socket, "garbage\n")) as BrokerResponse).refusal, "denial_budget_exhausted");
    const done = await inflight;
    assert.equal(done.state, "confirmed", JSON.stringify(done).slice(0, 300));
    assert.equal(fs.readFileSync(path.join(f.root, "done.txt"), "utf8"), "done\n");
    const trail = journalTrail(journalFile);
    assert.deepEqual(trail.slice(-1), ["effect:confirmed"], "the outcome was journaled after the budget ran out");
    assert.ok(fs.statSync(journalFile).size > size, "only the in-flight outcome grew the journal");
  } finally {
    await running.close();
  }
  const summary = fs.readFileSync(path.join(path.dirname(journalFile), "input-summary.jsonl"), "utf8");
  assert.match(summary, /"denial_budget_exhausted":[1-9]/);
});

test("stop never signals another repository's broker that got the recorded pid", async () => {
  const a = fixture();
  const b = fixture();
  const brokerA = await serve(a);
  const brokerB = await serve(b);
  try {
    const stateB = fs.readdirSync(path.join(b.stateDir, "admission")).map((d) => path.join(b.stateDir, "admission", d))[0]!;
    const infoB = JSON.parse(fs.readFileSync(path.join(stateB, "broker.json"), "utf8")) as Record<string, unknown>;
    await stop(brokerB);
    // B's record survives a crash; its pid now belongs to A's broker (also `admission serve`, another start time and cmdline).
    fs.writeFileSync(path.join(stateB, "broker.json"), `${JSON.stringify({ ...infoB, pid: brokerA.pid })}\n`);
    const r = spawnSync(process.execPath, [CLI, "admission", "stop"], { cwd: b.root, env: b.env, encoding: "utf8" });
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /not running/);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(brokerA.exitCode, null);
    assert.equal(brokerA.signalCode, null, "A's broker was not signalled");
  } finally {
    await stop(brokerA);
  }
});

test("serve refuses a group- or world-writable policy file", () => {
  const f = fixture();
  fs.chmodSync(f.policy, 0o664);
  // A broker that accepted the policy would serve until killed: the timeout turns that into a failure, not a hang.
  const r = spawnSync(process.execPath, serveArgs(f), { cwd: f.root, env: f.env, encoding: "utf8", timeout: 15_000, killSignal: "SIGKILL" });
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stderr, /not group or world writable/);
});

test("an existing broker state dir that is group or world accessible is narrowed to 0700", async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.stateDir, "admission"), { recursive: true, mode: 0o755 });
  fs.chmodSync(path.join(f.stateDir, "admission"), 0o755);
  const running = await startBroker(inProcessOptions(f));
  try {
    const admission = path.join(f.stateDir, "admission");
    assert.equal((fs.statSync(admission).mode & 0o777).toString(8), "700");
    for (const d of fs.readdirSync(admission)) assert.equal((fs.statSync(path.join(admission, d)).mode & 0o777).toString(8), "700");
  } finally {
    await running.close();
  }
});
