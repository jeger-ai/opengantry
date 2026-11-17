/**
 * The MCP relay to the admission broker (issue #356, MSN-0394): gxt_admission_request forwards one broker message to the
 * socket named by GANTRY_BROKER_SOCKET. The relay is a client of the same socket, so the broker's framing, size bound,
 * denial budget and journal-before-effect apply unchanged; these cases repeat the socket tests' cases through the relay.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { gitChildEnv } from "#git/git.js";
import type { BrokerResponse, RequestTemplate } from "#missions/admission/broker.js";
import { buildAdmissionRequest, posixFileRef, sha256File } from "#missions/admission/client.js";
import { admissionJournalPath } from "#missions/admission/journal-file.js";
import { relayAdmissionMessage, type AdmissionRelayResult } from "#missions/admission/relay.js";
import { startBroker } from "#missions/admission/serve.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGxtMcpTools } from "../../mcp/mcp-tools-register.js";
import { CONTRACT_DIGEST, brokerRepo, journalTrail, writePolicy } from "./fixtures.js";

const BROKER_MAX = 1024 * 1024 + 64 * 1024;

/** Temp dirs this file made; removed when the file's tests are done (shared /tmp is an inode-limited tmpfs). */
const made: string[] = [];
after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

/** A short socket dir (sun_path is 108 bytes), 0700. */
function socketDir(): string {
  const base = Buffer.byteLength(os.tmpdir()) < 60 ? os.tmpdir() : "/tmp";
  const dir = fs.mkdtempSync(path.join(base, "og-relay-"));
  made.push(dir);
  return dir;
}

async function brokerFixture(extra: Record<string, unknown> = {}) {
  const { root, outside } = brokerRepo();
  made.push(root, outside);
  const policy = writePolicy(path.join(outside, "policy.json"));
  const socket = path.join(socketDir(), "b.sock");
  const env = gitChildEnv({ GANTRY_STATE_DIR: path.join(outside, "state") });
  const running = await startBroker({ root, harness: "claude-code", contractDigest: CONTRACT_DIGEST, policy, socket, assumePlatform: "ubuntu-26.04-x64", env, ...extra });
  return { root, socket, running, relayEnv: { GANTRY_BROKER_SOCKET: socket } as NodeJS.ProcessEnv };
}

function answered(r: AdmissionRelayResult): BrokerResponse {
  assert.equal(r.status, "answered", JSON.stringify(r));
  return (r as { response: BrokerResponse }).response;
}

async function writeThroughRelay(env: NodeJS.ProcessEnv, root: string, rel: string, content: string, nonce?: string): Promise<BrokerResponse> {
  const prepared = answered(await relayAdmissionMessage({ type: "prepare", kind: "workspace.write" }, { env }));
  if (prepared.refusal === "denial_budget_exhausted") return prepared;
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const t = prepared.template as RequestTemplate;
  const abs = path.join(root, rel);
  const parent = posixFileRef(path.dirname(abs));
  const args = { contentBase64: Buffer.from(content).toString("base64") };
  const resource = { path: path.join(parent.path, path.basename(abs)), parent, priorContentDigest: fs.existsSync(abs) ? sha256File(abs) : "absent" };
  const request = { ...buildAdmissionRequest(t, resource, args), ...(nonce === undefined ? {} : { nonce }) };
  return answered(await relayAdmissionMessage({ type: "dispatch", request, args }, { env }));
}

test("relay: capabilities and a workspace.write dispatch reach the broker; the intent is journaled before the outcome", async () => {
  const f = await brokerFixture();
  try {
    const caps = answered(await relayAdmissionMessage({ type: "capabilities" }, { env: f.relayEnv }));
    assert.equal(caps.ok, true, JSON.stringify(caps));
    const res = await writeThroughRelay(f.relayEnv, f.root, "note.txt", "hello\n");
    assert.equal(res.state, "confirmed", JSON.stringify(res).slice(0, 400));
    assert.equal(fs.readFileSync(path.join(f.root, "note.txt"), "utf8"), "hello\n");
    const trail = journalTrail(admissionJournalPath(f.root)!);
    assert.deepEqual(trail.slice(-3), ["decision:allow", "effect:dispatch-intent", "effect:confirmed"]);
    assert.equal("permit" in res, false, "the permit never leaves the broker");
  } finally {
    await f.running.close();
  }
});

test("relay: malformed, unknown-shape and oversized messages get the broker's deny, and it keeps serving", async () => {
  const f = await brokerFixture();
  try {
    for (const message of [{ type: "dispatch", request: { x: 1 }, args: null }, { type: "nope" }, ["not", "an", "object"]]) {
      assert.equal(answered(await relayAdmissionMessage(message, { env: f.relayEnv })).refusal, "request_malformed");
    }
    const big = { type: "capabilities", pad: "a".repeat(BROKER_MAX + 10) };
    assert.equal(answered(await relayAdmissionMessage(big, { env: f.relayEnv })).refusal, "request_malformed");
    assert.equal(answered(await relayAdmissionMessage({ type: "capabilities" }, { env: f.relayEnv })).ok, true);
  } finally {
    await f.running.close();
  }
});

test("relay: a message cannot smuggle a second line (JSON never carries a raw newline), so one call is one message", async () => {
  const f = await brokerFixture();
  try {
    const r = answered(await relayAdmissionMessage({ type: "nope", note: "x\n{\"type\":\"capabilities\"}" }, { env: f.relayEnv }));
    assert.equal(r.refusal, "request_malformed");
  } finally {
    await f.running.close();
  }
});

test("relay: once the denial budget is spent the relay gets the broker's fixed refusal", async () => {
  const f = await brokerFixture({ journalDenialMaxBytes: 4000 });
  try {
    let last: BrokerResponse | null = null;
    for (let i = 0; i < 60 && last?.refusal !== "denial_budget_exhausted"; i += 1) {
      // A nonce the broker never issued: a well-formed request refused (permit_unknown) and journaled.
      last = await writeThroughRelay(f.relayEnv, f.root, `d${i}.txt`, "x", `${i}`.padStart(32, "0"));
      if (last.refusal !== "denial_budget_exhausted") assert.equal(last.refusal, "permit_unknown");
    }
    assert.equal(last?.refusal, "denial_budget_exhausted");
    assert.equal(answered(await relayAdmissionMessage({ type: "capabilities" }, { env: f.relayEnv })).refusal, "denial_budget_exhausted");
  } finally {
    await f.running.close();
  }
});

test("relay fails closed without a broker: unset, relative, missing, not a socket, or nobody listening", async () => {
  const dir = socketDir();
  const notSocket = path.join(dir, "file");
  fs.writeFileSync(notSocket, "x");
  const stale = path.join(dir, "stale.sock");
  const srv = net.createServer();
  await new Promise<void>((r) => srv.listen(stale, r));
  // Closing a listener removes its socket file; leave a socket inode nobody listens on.
  await new Promise<void>((r) => srv.close(() => r()));
  const cases: [string, NodeJS.ProcessEnv][] = [
    ["unset", {}],
    ["relative", { GANTRY_BROKER_SOCKET: "b.sock" }],
    ["missing", { GANTRY_BROKER_SOCKET: path.join(dir, "absent.sock") }],
    ["not a socket", { GANTRY_BROKER_SOCKET: notSocket }],
    ["nobody listening", { GANTRY_BROKER_SOCKET: stale }],
  ];
  for (const [name, env] of cases) {
    const r = await relayAdmissionMessage({ type: "capabilities" }, { env });
    assert.equal(r.status, "unavailable", `${name}: ${JSON.stringify(r)}`);
    assert.equal((r as { code: string }).code, "ADMISSION_BROKER_UNAVAILABLE", name);
  }
});

/** The registered gxt_admission_request tool, called as the MCP server calls it; returns its parsed JSON text. */
async function callAdmissionTool(args: Record<string, unknown>): Promise<AdmissionRelayResult> {
  let handler: ((a: Record<string, unknown>) => Promise<{ content: { text: string }[] }>) | undefined;
  const fake = { tool: (name: string, _d: string, _s: unknown, h: typeof handler) => void (name === "gxt_admission_request" && (handler = h)) } as unknown as McpServer;
  registerGxtMcpTools(fake);
  assert.ok(handler, "gxt_admission_request is registered");
  return JSON.parse((await handler(args)).content[0]!.text) as AdmissionRelayResult;
}

test("gxt_admission_request tool: forwards to the broker named by GANTRY_BROKER_SOCKET and fails closed without one", async () => {
  const f = await brokerFixture();
  const saved = process.env.GANTRY_BROKER_SOCKET;
  try {
    process.env.GANTRY_BROKER_SOCKET = f.socket;
    const r = await callAdmissionTool({ message: { type: "capabilities" } });
    assert.equal(r.status, "answered", JSON.stringify(r));
    delete process.env.GANTRY_BROKER_SOCKET;
    const none = await callAdmissionTool({ message: { type: "capabilities" } });
    assert.equal(none.status, "unavailable");
  } finally {
    if (saved === undefined) delete process.env.GANTRY_BROKER_SOCKET;
    else process.env.GANTRY_BROKER_SOCKET = saved;
    await f.running.close();
  }
});
