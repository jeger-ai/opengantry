/**
 * `gantry admission serve` as a real process (issue #356 slice 3): untrusted socket input, concurrent clients in separate
 * processes, and a broker killed between the dispatch intent and the outcome (ADM-T04).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { getRepoRoot, gitChildEnv } from "#git/git.js";
import type { BrokerResponse, RequestTemplate } from "#missions/admission/broker.js";
import { buildAdmissionRequest, posixFileRef, sendBrokerMessage, sendBrokerRaw, sha256File } from "#missions/admission/client.js";
import { environmentNamesDigest } from "#missions/admission/dispatch.js";
import { admissionJournalPath } from "#missions/admission/journal-file.js";
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
