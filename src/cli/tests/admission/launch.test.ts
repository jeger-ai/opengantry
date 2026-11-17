/**
 * `gantry admission launch -- <harness…>` (issue #356, MSN-0394): a session broker for one harness run. The harness gets
 * GANTRY_BROKER_SOCKET, its MCP server (simulated here by a fake harness calling the relay the gxt_admission_request tool calls)
 * reaches the broker, the harness's exit status is launch's, and the broker is gone when the harness is.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { getRepoRoot, gitChildEnv } from "#git/git.js";
import { CONTRACT_DIGEST, brokerRepo, writePolicy } from "./fixtures.js";

const OG = getRepoRoot();
const CLI = path.join(OG, "dist", "cli", "index.js");
/** What the gxt_admission_request tool calls: the fake harness plays its MCP server. */
const RELAY = path.join(OG, "dist", "packages", "missions", "src", "admission", "relay.js");

/** Temp dirs this file made; removed when the file's tests are done (shared /tmp is an inode-limited tmpfs). */
const made: string[] = [];
after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

function socketDir(): string {
  const base = Buffer.byteLength(os.tmpdir()) < 60 ? os.tmpdir() : "/tmp";
  const dir = fs.mkdtempSync(path.join(base, "og-launch-"));
  made.push(dir);
  return dir;
}

/** A fake harness: asks the broker for its capabilities through the MCP relay, prints the result, exits with argv[2]. */
function fakeHarness(dir: string): string {
  const file = path.join(dir, "harness.mjs");
  fs.writeFileSync(
    file,
    `import { relayAdmissionMessage } from ${JSON.stringify(RELAY)};
const r = await relayAdmissionMessage({ type: "capabilities" });
console.log(JSON.stringify({ socket: process.env.GANTRY_BROKER_SOCKET ?? null, status: r.status, ok: r.response?.ok ?? null }));
if (process.argv[2] === "wait") { process.on("SIGTERM", () => process.exit(42)); setInterval(() => {}, 1000); console.log("waiting"); }
else process.exit(Number(process.argv[2] ?? 0));
`,
  );
  return file;
}

function fixture() {
  const { root, outside } = brokerRepo();
  made.push(root, outside);
  const policy = writePolicy(path.join(outside, "policy.json"));
  const stateDir = path.join(outside, "state");
  const socket = path.join(socketDir(), "b.sock");
  return { root, outside, policy, socket, stateDir, env: gitChildEnv({ GANTRY_STATE_DIR: stateDir }) };
}

function launchArgs(f: ReturnType<typeof fixture>, cmd: string[]): string[] {
  return [CLI, "admission", "launch", "--harness", "claude-code", "--contract-digest", CONTRACT_DIGEST, "--policy", f.policy, "--socket", f.socket, "--assume-platform", "ubuntu-26.04-x64", "--", ...cmd];
}

function run(f: ReturnType<typeof fixture>, cmd: string[], onStdout?: (text: string, child: ReturnType<typeof spawn>) => void): Promise<{ code: number | null; signal: NodeJS.Signals | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, launchArgs(f, cmd), { cwd: f.root, env: f.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout!.on("data", (b: Buffer) => {
      out += b.toString();
      onStdout?.(out, child);
    });
    child.stderr!.on("data", (b: Buffer) => (err += b.toString()));
    child.on("close", (code, signal) => resolve({ code, signal, out, err }));
  });
}

function stateLeft(f: ReturnType<typeof fixture>): string[] {
  const admission = path.join(f.stateDir, "admission");
  if (!fs.existsSync(admission)) return [];
  return fs.readdirSync(admission).flatMap((key) => fs.readdirSync(path.join(admission, key)).filter((n) => n === "broker.lock" || n === "broker.json"));
}

test("launch: the harness reaches the broker through GANTRY_BROKER_SOCKET, its exit code is launch's, and the broker stops with it", async () => {
  const f = fixture();
  const harness = fakeHarness(f.outside);
  const r = await run(f, [process.execPath, harness, "7"]);
  assert.equal(r.code, 7, `${r.out}\n${r.err}`);
  const line = r.out.split("\n").find((l) => l.startsWith("{\"socket\""));
  assert.ok(line, r.out);
  assert.deepEqual(JSON.parse(line), { socket: f.socket, status: "answered", ok: true });
  assert.equal(fs.existsSync(f.socket), false, "the socket is removed");
  assert.deepEqual(stateLeft(f), [], "the instance lock and broker.json are released");
});

test("launch: SIGTERM is passed to the harness, and the broker stops after it exits", async () => {
  const f = fixture();
  const harness = fakeHarness(f.outside);
  let sent = false;
  const r = await run(f, [process.execPath, harness, "wait"], (out, child) => {
    if (!sent && out.includes("waiting")) {
      sent = true;
      child.kill("SIGTERM");
    }
  });
  assert.equal(r.code, 42, `${r.out}\n${r.err}`);
  assert.equal(fs.existsSync(f.socket), false);
  assert.deepEqual(stateLeft(f), []);
});

test("launch refuses without a harness command, and when the command cannot start (the broker is released)", async () => {
  const f = fixture();
  const none = await run(f, []);
  assert.equal(none.code, 2, none.err);
  assert.match(none.err, /GXT_ADMISSION_BROKER_CONFIG_INVALID/);
  const missing = await run(f, [path.join(f.outside, "no-such-harness")]);
  assert.notEqual(missing.code, 0);
  assert.match(missing.err, /no-such-harness/);
  assert.equal(fs.existsSync(f.socket), false);
  assert.deepEqual(stateLeft(f), []);
});
