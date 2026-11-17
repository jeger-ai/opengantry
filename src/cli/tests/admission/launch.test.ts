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
import { admissionJournalPath } from "#missions/admission/journal-file.js";
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
else if (process.argv[2] === "sigint") {
  // Claude Code exits on a second Ctrl-C: count every SIGINT, then exit 10 + the count once they have settled.
  let n = 0;
  process.on("SIGINT", () => { n += 1; console.log("harness SIGINT " + n); if (n === 1) setTimeout(() => process.exit(10 + n), 700); });
  setInterval(() => {}, 1000);
  console.log("waiting");
}
else if (process.argv[2] === "usr2") process.kill(process.pid, "SIGUSR2");
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

type Launched = ReturnType<typeof spawn>;

function run(
  f: ReturnType<typeof fixture>,
  cmd: string[],
  onStdout?: (text: string, child: Launched) => void,
  opts: { detached?: boolean; onSpawn?: (child: Launched) => void } = {},
): Promise<{ code: number | null; signal: NodeJS.Signals | null; out: string; err: string }> {
  return new Promise((resolve) => {
    // detached: the launcher leads its own process group, as a terminal's foreground job does.
    const child = spawn(process.execPath, launchArgs(f, cmd), { cwd: f.root, env: f.env, stdio: ["ignore", "pipe", "pipe"], detached: opts.detached ?? false });
    opts.onSpawn?.(child);
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

test("launch: one Ctrl-C to the process group reaches the harness once (the launcher does not pass SIGINT on), and the broker stops after it", async () => {
  const f = fixture();
  const harness = fakeHarness(f.outside);
  let sent = false;
  const r = await run(
    f,
    [process.execPath, harness, "sigint"],
    (out, child) => {
      if (!sent && out.includes("waiting")) {
        sent = true;
        // What a terminal does on Ctrl-C: one SIGINT to every process of the foreground group.
        process.kill(-child.pid!, "SIGINT");
      }
    },
    { detached: true },
  );
  assert.equal(r.out.match(/harness SIGINT \d/g)?.length, 1, `${r.out}\n${r.err}`);
  assert.equal(r.code, 11, `${r.out}\n${r.err}`);
  assert.equal(fs.existsSync(f.socket), false);
  assert.deepEqual(stateLeft(f), []);
});

test("launch: a harness killed by signal n exits 128+n (SIGUSR2 is 140 on Linux)", async () => {
  const f = fixture();
  const harness = fakeHarness(f.outside);
  const r = await run(f, [process.execPath, harness, "usr2"]);
  assert.equal(r.code, 128 + os.constants.signals.SIGUSR2, `${r.out}\n${r.err}`);
  assert.equal(r.code, 140);
  assert.deepEqual(stateLeft(f), []);
});

test("launch: a signal while the broker starts stops it before any harness runs, exits 128+n and leaves no lock", async () => {
  const f = fixture();
  const harness = fakeHarness(f.outside);
  // Hold the journal lock so that startup waits (synchronously, up to 2 s) after taking the instance lock.
  const journalLock = `${admissionJournalPath(f.root)!}.lock`;
  fs.mkdirSync(path.dirname(journalLock), { recursive: true });
  fs.writeFileSync(journalLock, "held by the test\n");
  let poll: NodeJS.Timeout | undefined;
  const r = await run(f, [process.execPath, harness, "0"], undefined, {
    onSpawn: (child) => {
      poll = setInterval(() => {
        const admission = path.join(f.stateDir, "admission");
        const locked = fs.existsSync(admission) && fs.readdirSync(admission).some((k) => fs.existsSync(path.join(admission, k, "broker.lock")));
        if (!locked) return;
        clearInterval(poll);
        child.kill("SIGTERM");
        fs.rmSync(journalLock, { force: true });
      }, 5);
    },
  });
  clearInterval(poll);
  fs.rmSync(journalLock, { force: true });
  assert.equal(r.signal, null, `the launcher was killed by ${String(r.signal)}: ${r.err}`);
  assert.equal(r.code, 128 + os.constants.signals.SIGTERM, `${r.out}\n${r.err}`);
  assert.equal(r.out.includes("\"socket\""), false, "no harness ran");
  assert.equal(fs.existsSync(f.socket), false);
  assert.deepEqual(stateLeft(f), [], "the instance lock and broker.json are released");
});
