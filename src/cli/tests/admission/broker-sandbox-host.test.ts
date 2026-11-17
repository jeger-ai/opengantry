/**
 * MSN-0394 (#356): host canaries for how the sandboxed agent may reach the admission broker.
 *
 * Owner decision (2026-11-17): every Unix socket stays blocked in the harness sandbox; the agent was to reach the broker
 * through an fd handed over at launch. These canaries record why that is not available, and that the broker's socket
 * is unreachable by path from a sandbox with srt's Unix-socket filter, while the MCP relay (outside) answers:
 *
 * 1. a Node process marks every inherited fd above 2 close-on-exec at startup, so its children never get one: Claude
 *    Code and srt's CLI are Node programs;
 * 2. bwrap itself passes an inherited fd through (so the drop is not bwrap's);
 * 3. srt's CLI passes only stdio to the sandboxed command;
 * 4. with srt's documented seccomp rules applied by `bwrap --seccomp`, connecting to the broker socket by path fails
 *    (EPERM) where the same sandbox without the filter connects (control);
 * 5. full srt policy mode (its own seccomp helper): connecting by path fails and no fd arrives. Skipped with the reason
 *    where srt's helper cannot start (Ubuntu's AppArmor userns restriction, until the owner installs the profile).
 *
 * A missing prerequisite (Linux, x86-64 for the filter, bwrap that can start, srt and socat on PATH) skips its test with
 * the reason; nothing passes silently.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, type StdioOptions } from "node:child_process";
import { gitChildEnv } from "#git/git.js";
import { relayAdmissionMessage } from "#missions/admission/relay.js";
import { startBroker } from "#missions/admission/serve.js";
import { CONTRACT_DIGEST, brokerRepo, writePolicy } from "./fixtures.js";
import { unixSocketSeccompFilter } from "./seccomp-unix-filter.js";

const onPath = (cmd: string): boolean => (process.env.PATH ?? "").split(path.delimiter).some((d) => d !== "" && fs.existsSync(path.join(d, cmd)));
const LINUX = process.platform === "linux" ? null : `skipped: ${process.platform} is not Linux`;

function bwrapSkip(): string | null {
  if (LINUX) return LINUX;
  if (!onPath("bwrap")) return "skipped: bwrap is not on PATH";
  const r = spawnSync("bwrap", ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--unshare-all", "--", "true"], { encoding: "utf8" });
  return r.status === 0 ? null : `skipped: bwrap cannot start a sandbox here (${(r.stderr || r.error?.message || "").trim()})`;
}

function srtSkip(): string | null {
  if (LINUX) return LINUX;
  if (!onPath("srt")) return "skipped: srt (@anthropic-ai/sandbox-runtime) is not on PATH";
  if (!onPath("socat")) return "skipped: socat is not on PATH (srt needs it)";
  return bwrapSkip();
}

const BWRAP = bwrapSkip();
const SRT = srtSkip();
const FILTER = BWRAP ?? (process.arch === "x64" ? null : `skipped: the seccomp transcription is x86-64 only (this is ${process.arch})`);

/** The sandboxed probe: writes "ping" to fd 3 if it has one, then connects to $PROBE_SOCK and reports the outcome. */
const CONNECT_JS = `const c=require("node:net").createConnection(process.env.PROBE_SOCK);c.on("connect",()=>{console.log("CONNECT=connected");c.destroy()});c.on("error",e=>console.log("CONNECT="+e.code))`;
const PROBE_SH = `{ echo ping >&3; } 2>/dev/null && echo FD=present || echo FD=absent; exec "$PROBE_NODE" -e '${CONNECT_JS}'`;

interface Probe {
  code: number | null;
  stdout: string;
  stderr: string;
  /** The test's end of the socketpair received "ping": the inherited fd reached the sandboxed shell and worked. */
  fdReceived: boolean;
  fd: string | undefined;
  connect: string | undefined;
}

/** Run `argv` (a wrapper whose last words are `sh -c PROBE_SH`) with a socketpair end as fd 3 and `extra` fds after it. */
function runProbe(argv: string[], env: NodeJS.ProcessEnv, extra: number[] = []): Promise<Probe> {
  return new Promise((resolve) => {
    const stdio: StdioOptions = ["ignore", "pipe", "pipe", "pipe", ...extra];
    const child = spawn(argv[0]!, argv.slice(1), { env, stdio });
    let stdout = "";
    let stderr = "";
    let fd3 = "";
    child.stdout!.on("data", (b: Buffer) => (stdout += b.toString()));
    child.stderr!.on("data", (b: Buffer) => (stderr += b.toString()));
    const end = child.stdio[3] as NodeJS.ReadableStream & { on: (e: string, f: (x: unknown) => void) => void };
    end.on("data", (b) => (fd3 += String(b)));
    end.on("error", () => undefined);
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, fdReceived: fd3.includes("ping"), fd: /FD=(\w+)/.exec(stdout)?.[1], connect: /CONNECT=(\w+)/.exec(stdout)?.[1] });
    });
  });
}

function shortDir(prefix: string): string {
  const base = Buffer.byteLength(os.tmpdir()) < 60 ? os.tmpdir() : "/tmp";
  return fs.mkdtempSync(path.join(base, prefix));
}

async function withBroker<T>(fn: (socket: string) => Promise<T>): Promise<T> {
  const { root, outside } = brokerRepo();
  const policy = writePolicy(path.join(outside, "policy.json"));
  const socket = path.join(shortDir("og-sbx-"), "b.sock");
  const running = await startBroker({ root, harness: "claude-code", contractDigest: CONTRACT_DIGEST, policy, socket, assumePlatform: "ubuntu-26.04-x64", env: gitChildEnv({ GANTRY_STATE_DIR: path.join(outside, "state") }) });
  try {
    return await fn(socket);
  } finally {
    await running.close();
  }
}

const probeEnv = (socket: string): NodeJS.ProcessEnv => ({ ...process.env, PROBE_SOCK: socket, PROBE_NODE: process.execPath });
const BWRAP_BASE = ["bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--unshare-all", "--new-session", "--die-with-parent"];

test("canary: a Node process marks inherited fds close-on-exec, so the commands it spawns never get them", { skip: LINUX ?? false }, async () => {
  const intermediary = `require("node:child_process").spawn("sh",["-c",process.env.PROBE_SH],{stdio:"inherit"}).on("exit",c=>process.exit(c??1))`;
  const r = await runProbe([process.execPath, "-e", intermediary], { ...probeEnv("/nonexistent/b.sock"), PROBE_SH });
  assert.equal(r.fd, "absent", r.stdout + r.stderr);
  assert.equal(r.fdReceived, false);
  // Control: the same shell started directly does get the fd.
  const direct = await runProbe(["sh", "-c", PROBE_SH], probeEnv("/nonexistent/b.sock"));
  assert.equal(direct.fd, "present", direct.stdout + direct.stderr);
  assert.equal(direct.fdReceived, true);
});

test("canary: bwrap passes an inherited fd through to the sandboxed command (the drop is not bwrap's)", { skip: BWRAP ?? false }, async () => {
  const r = await runProbe([...BWRAP_BASE, "--", "sh", "-c", PROBE_SH], probeEnv("/nonexistent/b.sock"));
  assert.equal(r.fd, "present", r.stdout + r.stderr);
  assert.equal(r.fdReceived, true);
});

test("canary: srt's CLI passes only stdio to the sandboxed command (an inherited fd 3 does not arrive)", { skip: SRT ?? false, timeout: 120_000 }, async (t) => {
  const dir = shortDir("og-srt-");
  const settings = path.join(dir, "srt.json");
  fs.writeFileSync(settings, JSON.stringify({ network: { allowedDomains: [], deniedDomains: [], allowAllUnixSockets: true }, filesystem: { denyRead: [], allowWrite: [dir], denyWrite: [] } }));
  const r = await runProbe(["srt", "--settings", settings, "--", "sh", "-c", PROBE_SH], probeEnv("/nonexistent/b.sock"));
  if (r.fd === undefined) return t.skip(`skipped: srt did not run the command (exit ${String(r.code)}): ${r.stderr.trim().slice(-300)}`);
  assert.equal(r.fd, "absent", r.stdout + r.stderr);
  assert.equal(r.fdReceived, false);
});

test("canary: under srt's Unix-socket seccomp rules (bwrap --seccomp) the broker socket is unreachable by path; the relay outside answers", { skip: FILTER ?? false, timeout: 120_000 }, async () => {
  await withBroker(async (socket) => {
    const control = await runProbe([...BWRAP_BASE, "--", "sh", "-c", PROBE_SH], probeEnv(socket));
    assert.equal(control.connect, "connected", `control: the sandbox without the filter reaches the socket path: ${control.stdout}${control.stderr}`);

    const filterFile = path.join(shortDir("og-bpf-"), "unix.bpf");
    fs.writeFileSync(filterFile, unixSocketSeccompFilter());
    const fd = fs.openSync(filterFile, "r");
    try {
      // stdio index 4 is the filter: bwrap reads it as `--seccomp 4`.
      const filtered = await runProbe([...BWRAP_BASE, "--seccomp", "4", "--", "sh", "-c", PROBE_SH], probeEnv(socket), [fd]);
      assert.equal(filtered.connect, "EPERM", `filtered: ${filtered.stdout}${filtered.stderr}`);
      assert.equal(filtered.fd, "present", "the filter blocks creating a socket, not using an inherited one");
      assert.equal(filtered.fdReceived, true);
    } finally {
      fs.closeSync(fd);
    }

    const relayed = await relayAdmissionMessage({ type: "capabilities" }, { env: { GANTRY_BROKER_SOCKET: socket } });
    assert.equal(relayed.status, "answered", JSON.stringify(relayed));
  });
});

test("canary: full srt policy mode: the broker socket is unreachable by path and no inherited fd arrives", { skip: SRT ?? false, timeout: 120_000 }, async (t) => {
  await withBroker(async (socket) => {
    const dir = shortDir("og-srt-");
    const settings = path.join(dir, "srt.json");
    fs.writeFileSync(settings, JSON.stringify({ network: { allowedDomains: [], deniedDomains: [] }, filesystem: { denyRead: [], allowWrite: [dir], denyWrite: [] } }));
    const r = await runProbe(["srt", "--settings", settings, "--", "sh", "-c", PROBE_SH], probeEnv(socket));
    if (r.fd === undefined) {
      return t.skip(`skipped: srt's seccomp helper did not start, so policy mode cannot run here (needs the AppArmor profile for bwrap's nested user namespace): exit ${String(r.code)}: ${r.stderr.trim().slice(-300)}`);
    }
    assert.notEqual(r.connect, "connected", r.stdout + r.stderr);
    assert.equal(r.connect, "EPERM", r.stdout + r.stderr);
    assert.equal(r.fd, "absent");
    assert.equal(r.fdReceived, false);
  });
});
