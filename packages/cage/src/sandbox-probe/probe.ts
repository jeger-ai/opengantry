import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { canonicalJson } from "#core/canonical-json.js";
import { fdClosingSpawn } from "#core/close-fds.js";
import { CANARY_TECHNIQUES, PROBE_SCHEMA, type CanaryOutcome, type ProbeHost, type ProbeRecord } from "#core/admission-canary.js";
import dgram from "node:dgram";
import {
  CANARY_SPECS,
  INHERITED_FD,
  assertSpecsComplete,
  brokerSnapshot,
  canaryScript,
  judgeCanary,
  node,
  proxyConnectJs,
  socksConnectJs,
  snapshotTargets,
  type BrokerHandle,
  type CanaryContext,
  type CanarySpec,
} from "./canaries.js";
import { fileState, makeFixture, removeFixture, type Fixture } from "./fixture.js";
import { claudeSettingsToSrtConfig, type SrtConfig } from "./srt-config.js";
import type { SandboxRuntime } from "./runtime.js";

/**
 * Run every canary through the sandbox runtime with the generated policy (MSN-0391). One fresh fixture per canary;
 * the policy is generated for that fixture by `generatePolicy` (the caller runs `gantry cage policy --agent
 * claude-code` with the fixture's home and state dir). Listeners outside the sandbox count connections. Nothing here
 * decides a capability level; `judgeProbe` in core does.
 */

export interface ProbeOptions {
  runtime: SandboxRuntime;
  host: ProbeHost;
  diagnostic: boolean;
  generatePolicy: (repo: string, env: NodeJS.ProcessEnv) => string;
  /**
   * Start an admission broker for a fixture, outside the sandbox, listening on `socket` (the caller runs `gantry
   * admission serve`). Without it the broker canaries are inconclusive.
   */
  startBroker?: (fx: Fixture, socket: string) => Promise<{ handle: BrokerHandle; stop: () => Promise<void> }>;
  /** Called before each canary runs, for progress output. */
  onCanary?: (id: string) => void;
  /**
   * `--via-launch` (MSN-0396): the argv that starts `gantry admission launch` for a fixture, with its broker on
   * `socket`, ending in `--`. The control and write-inherited-fd then run as a real session does: the planted fd past
   * the gap reaches the launcher, which starts srt. Without it the runtime is started directly.
   */
  launch?: (fx: Fixture, socket: string) => string[];
}

/** The canaries that start through the launcher under `--via-launch`: the one whose result the launch path changes. */
const VIA_LAUNCH = new Set(["write-inherited-fd"]);
const VIA_LAUNCH_NOTE = "started via gantry admission launch";

const sha = (text: string): string => crypto.createHash("sha256").update(text, "utf8").digest("hex");
const RUN_TIMEOUT_MS = 90_000;

interface Listeners {
  ctx: CanaryContext;
  current: { id: string };
  close: () => Promise<void>;
}

const listen = (server: net.Server, port: number, host: string): Promise<boolean> =>
  new Promise((resolve) => {
    const fail = (): void => resolve(false);
    server.once("error", fail);
    server.listen(port, host, () => {
      server.off("error", fail);
      resolve(true);
    });
  });
const closeServer = (s: net.Server): Promise<void> => new Promise((resolve) => s.close(() => resolve()));

/**
 * The outside listeners: TCP on 127.0.0.1:<port> and, where the host has IPv6 loopback, [::1]:<port>; TCP on
 * 127.0.0.1:<port+1> (the adjacent port, counted as `<id>@adjacent`); UDP on 127.0.0.1; a unix socket. Each counts
 * what arrives under the canary id whose window is open.
 */
async function openListeners(dir: string): Promise<Listeners> {
  const current = { id: "" };
  const connections = new Map<string, number>();
  const bump = (key: string): void => {
    connections.set(key, (connections.get(key) ?? 0) + 1);
  };
  const counter =
    (suffix = "") =>
    (s: net.Socket): void => {
      bump(`${current.id}${suffix}`);
      s.on("error", () => {});
      s.resume();
    };
  const unix = net.createServer(counter());
  const unixSocket = path.join(dir, "outside.sock");
  await new Promise<void>((resolve) => unix.listen(unixSocket, resolve));
  const servers: net.Server[] = [unix];
  // tcpPort and tcpPort + 1 on 127.0.0.1 (and [::1]:tcpPort when it binds): retry until a free pair is found.
  let tcpPort = 0;
  let ipv6 = false;
  for (let attempt = 0; attempt < 20 && tcpPort === 0; attempt++) {
    const tcp = net.createServer(counter());
    await listen(tcp, 0, "127.0.0.1");
    const port = (tcp.address() as net.AddressInfo).port;
    const adjacent = net.createServer(counter("@adjacent"));
    if (port >= 65535 || !(await listen(adjacent, port + 1, "127.0.0.1"))) {
      await closeServer(tcp);
      continue;
    }
    const v6 = net.createServer(counter());
    ipv6 = await listen(v6, port, "::1");
    servers.push(tcp, adjacent, ...(ipv6 ? [v6] : []));
    tcpPort = port;
  }
  if (tcpPort === 0) throw new Error("canary: no free pair of loopback ports for the listeners");
  const udp = dgram.createSocket("udp4");
  udp.on("message", () => bump(current.id));
  await new Promise<void>((resolve) => udp.bind(0, "127.0.0.1", resolve));
  const udpPort = udp.address().port;
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  const hasUserBus = !!runtimeDir && fs.existsSync(path.join(runtimeDir, "bus")) && onPath("systemd-run");
  const ctx: CanaryContext = {
    connections,
    tcpPort,
    adjacentPort: tcpPort + 1,
    udpPort,
    ipv6,
    unixSocket,
    hasPython: onPath("python3"),
    hasUserBus,
    broker: null,
    proxyControl: null,
    socksControl: null,
    hostControl: null,
    credentialEnvVars: [],
  };
  const close = async (): Promise<void> => {
    await Promise.all([...servers.map(closeServer), new Promise<void>((resolve) => udp.close(() => resolve()))]);
  };
  return { ctx, current, close };
}

function onPath(cmd: string): boolean {
  return (process.env.PATH ?? "").split(path.delimiter).some((d) => d !== "" && fs.existsSync(path.join(d, cmd)));
}

/**
 * The sandboxed command's environment: the fixture's home and state dir, the user's PATH and session bus, plus a
 * canary's planted variables. Built, not inherited, so the operator's own credentials never reach a canary; the env
 * canary plants random tokens in their place to test what Claude Code's pass-through environment exposes.
 */
function sandboxEnv(fx: Fixture, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "", HOME: fx.home, TMPDIR: fx.tmp, GANTRY_STATE_DIR: fx.stateEnv, LANG: "C.UTF-8" };
  for (const k of ["USER", "LOGNAME", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"]) if (process.env[k]) env[k] = process.env[k];
  return { ...env, ...extra };
}

/**
 * Connections the listeners saw outside every known window (the `""` bucket, between runs, or an unknown id). Any
 * such connection poisons the run: it cannot be attributed, so the control fails.
 */
export function strayConnections(connections: ReadonlyMap<string, number>, known: ReadonlySet<string>): number {
  let n = 0;
  for (const [key, count] of connections) if (!known.has(key.replace(/@adjacent$/, ""))) n += count;
  return n;
}

const PROXY_CONTROL_ID = "control-proxy";
const SOCKS_CONTROL_ID = "control-socks";
const HOST_CONTROL_ID = "control-proxy-host";

interface Prepared {
  fx: Fixture;
  policy: string;
  config: SrtConfig;
  configPath: string;
}

function prepare(opts: ProbeOptions, npm: boolean, broker = false, allowDomains: string[] = []): Prepared {
  const fx = makeFixture({ npm, broker });
  try {
    const policy = opts.generatePolicy(fx.repo, { HOME: fx.home, GANTRY_STATE_DIR: fx.stateEnv });
    const config = claudeSettingsToSrtConfig(JSON.parse(policy) as unknown, { tmpDir: fx.tmp, diagnostic: opts.diagnostic });
    config.network.allowedDomains.push(...allowDomains);
    const configPath = path.join(fx.base, "srt-settings.json");
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    return { fx, policy, config, configPath };
  } catch (err) {
    removeFixture(fx);
    throw err;
  }
}

/**
 * How the runtime is launched: through bash that closes every fd above 2 except the planted one, so the runtime sees
 * stdio plus, for the inherited-fd canary, fd INHERITED_FD past the closed gap 3..19 (PR #379 review: Node's
 * close-on-exec sweep stops at the first closed fd above 15, so that is the fd that can leak).
 */
export function sandboxLaunch(argv: readonly string[], fd: number | null, via: readonly string[] = []): { command: string; args: string[]; stdio: ("ignore" | "pipe" | number)[] } {
  const keep = fd !== null ? [INHERITED_FD] : [];
  const stdio: ("ignore" | "pipe" | number)[] = ["ignore", "ignore", "pipe"];
  if (fd !== null) {
    while (stdio.length < INHERITED_FD) stdio.push("ignore");
    stdio.push(fd);
  }
  return { ...fdClosingSpawn([...via, ...argv], keep, "og-canary-launch"), stdio };
}

interface SandboxRun {
  inheritFd?: string;
  extraEnv?: Record<string, string>;
  /** The launcher argv to start the runtime through (`--via-launch`). */
  via?: string[];
}

function runInSandbox(opts: ProbeOptions, p: Prepared, script: string, run: SandboxRun = {}): Promise<{ status: number | null; stderr: string }> {
  const { inheritFd, extraEnv, via } = run;
  return new Promise((resolve) => {
    const fd = inheritFd ? fs.openSync(inheritFd, "a") : null;
    const launch = sandboxLaunch([process.execPath, opts.runtime.cli, "-s", p.configPath, "-c", script], fd, via);
    const child = spawn(launch.command, launch.args, {
      cwd: p.fx.repo,
      env: sandboxEnv(p.fx, extraEnv),
      stdio: launch.stdio,
      detached: true,
    });
    let stderr = "";
    child.stderr!.on("data", (d: Buffer) => {
      if (stderr.length < 4096) stderr += d.toString("utf8");
    });
    // The runtime's relays and a canary's own children share the process group: kill the group, and resolve on exit,
    // since a leftover grandchild can hold stderr open after the runtime is gone.
    const killGroup = (): void => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        /* already gone */
      }
    };
    const timer = setTimeout(killGroup, RUN_TIMEOUT_MS);
    child.on("exit", (status) => {
      clearTimeout(timer);
      killGroup();
      if (fd !== null) fs.closeSync(fd);
      child.stderr!.destroy();
      resolve({ status, stderr });
    });
  });
}

/** Fixture paths out of a digest input, so the digest names the policy, not this run's temp dir. */
const normalized = (text: string, fx: Fixture): string => text.split(fx.base).join("<fixture>");

/** The launcher argv for a fixture under `--via-launch`, its broker socket in the probe's private socket dir. */
function viaLaunch(opts: ProbeOptions, fx: Fixture, socketDir: string, id: string): string[] | undefined {
  return opts.launch?.(fx, path.join(socketDir, `launch-${id}.sock`));
}

/** The launcher's own progress line is not why a run failed. */
const LAUNCH_INFO = /^gantry admission launch: (broker|harness exited)/;

async function runControl(opts: ProbeOptions, socketDir: string): Promise<{ ok: boolean; detail: string; policyDigest: string; srtConfigDigest: string; networkStrict: boolean }> {
  const p = prepare(opts, false, opts.launch !== undefined);
  try {
    const via = viaLaunch(opts, p.fx, socketDir, "control");
    const r = await runInSandbox(opts, p, "echo CONTROL > out/control.txt && cat README.txt > out/control-read.txt", { via });
    const wrote = fs.existsSync(path.join(p.fx.out, "control.txt")) && fs.readFileSync(path.join(p.fx.out, "control.txt"), "utf8").trim() === "CONTROL";
    const read = fs.existsSync(path.join(p.fx.out, "control-read.txt")) && fs.readFileSync(path.join(p.fx.out, "control-read.txt"), "utf8").trim() === "readable";
    const firstErr = normalized(r.stderr, p.fx).split("\n").find((l) => l.trim() !== "" && !LAUNCH_INFO.test(l))?.slice(0, 200) ?? `exit ${String(r.status)}`;
    const settings = JSON.parse(p.policy) as { sandbox?: { network?: { strictAllowlist?: unknown } } };
    const how = via ? ` (${VIA_LAUNCH_NOTE})` : "";
    return {
      ok: wrote && read,
      detail: wrote && read ? `the sandboxed control wrote and read inside the workspace${how}` : `the sandbox did not run the control${how}: ${firstErr}`,
      policyDigest: sha(normalized(p.policy, p.fx)),
      srtConfigDigest: sha(normalized(canonicalJson(p.config), p.fx)),
      networkStrict: settings.sandbox?.network?.strictAllowlist === true,
    };
  } finally {
    removeFixture(p.fx);
  }
}

/**
 * A proxy positive control: the same authenticated request, with its destination allowlisted, must reach the
 * listener. If it does not, a blocked proxy canary proves nothing and is inconclusive. One sandbox run per control,
 * so each has its own window: HTTP CONNECT and SOCKS5 to 127.0.0.1:<port>, HTTP CONNECT to localhost:<port>.
 */
async function runProxyControl(opts: ProbeOptions, l: Listeners, id: string, allow: string, js: string): Promise<{ ok: boolean; detail: string }> {
  const p = prepare(opts, false, false, [allow]);
  try {
    l.current.id = id;
    await runInSandbox(opts, p, `${node(js)}; exit 0`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    l.current.id = "";
    const n = l.ctx.connections.get(id) ?? 0;
    const read = (ext: string): string | null => {
      try {
        return fs.readFileSync(path.join(p.fx.out, `${id}.${ext}`), "utf8").slice(0, 80);
      } catch {
        return null;
      }
    };
    if (read("noproxy") !== null) return { ok: false, detail: "no HTTP_PROXY inside the sandbox" };
    const reply = read("reply") ?? "no reply";
    const what = allow.replace(/:\d+$/, ":<port>");
    return n > 0 ? { ok: true, detail: `with ${what} allowlisted the listener saw ${n} connection(s) (proxy replied: ${reply})` } : { ok: false, detail: `with ${what} allowlisted the listener saw no connection (proxy replied: ${reply})` };
  } finally {
    l.current.id = "";
    removeFixture(p.fx);
  }
}

async function runCanary(opts: ProbeOptions, spec: CanarySpec, l: Listeners): Promise<CanaryOutcome> {
  const scope = CANARY_TECHNIQUES.find((t) => t.id === spec.id)!.scope;
  if (spec.applicable && !spec.applicable(l.ctx)) return { id: spec.id, scope, result: "not-applicable", detail: "this host lacks what the canary needs" };
  if (spec.broker && !opts.startBroker) return { id: spec.id, scope, result: "inconclusive", detail: "no broker launcher" };
  // A launcher runs a broker of its own, so the fixture is a broker fixture (its journal left to the broker).
  const launched = opts.launch !== undefined && VIA_LAUNCH.has(spec.id);
  const p = prepare(opts, spec.npm === true, spec.broker === true || launched, spec.allowListener ? [`127.0.0.1:${l.ctx.tcpPort}`] : []);
  let stop: (() => Promise<void>) | null = null;
  try {
    if (spec.broker && opts.startBroker) {
      const started = await opts.startBroker(p.fx, path.join(path.dirname(l.ctx.unixSocket), `broker-${spec.id}.sock`));
      stop = started.stop;
      l.ctx.broker = started.handle;
      brokerSnapshot.clear();
      for (const f of started.handle.stateFiles) brokerSnapshot.set(f, fileState(f));
    }
    const before = snapshotTargets(spec, p.fx);
    l.ctx.credentialEnvVars = (p.config.credentials?.envVars ?? []).map((v) => `${v.name}=${v.mode}`);
    l.current.id = spec.id;
    const via = launched ? viaLaunch(opts, p.fx, path.dirname(l.ctx.unixSocket), spec.id) : undefined;
    await runInSandbox(opts, p, canaryScript(spec, p.fx, l.ctx), { inheritFd: spec.inheritFd?.(p.fx), extraEnv: spec.env?.(p.fx), via });
    await new Promise((resolve) => setTimeout(resolve, 50));
    l.current.id = "";
    const judged = judgeCanary(spec, p.fx, l.ctx, before);
    return { id: spec.id, scope, ...judged, ...(via ? { detail: `${judged.detail}; ${VIA_LAUNCH_NOTE}` } : {}) };
  } catch (err) {
    return { id: spec.id, scope, result: "inconclusive", detail: `could not run: ${(err as Error).message.slice(0, 200)}` };
  } finally {
    l.ctx.broker = null;
    if (stop) await stop();
    removeFixture(p.fx);
  }
}

export async function runSandboxProbe(opts: ProbeOptions): Promise<ProbeRecord> {
  assertSpecsComplete();
  const listenerDir = fs.mkdtempSync(path.join(fs.existsSync("/tmp") ? "/tmp" : path.dirname(opts.runtime.root), "og-canary-sock-"));
  let control: Awaited<ReturnType<typeof runControl>>;
  try {
    control = await runControl(opts, listenerDir);
  } catch (err) {
    fs.rmSync(listenerDir, { recursive: true, force: true });
    throw err;
  }
  const listeners = await openListeners(listenerDir);
  const canaries: CanaryOutcome[] = [];
  let proxy: { ok: boolean; detail: string } | undefined;
  let socks: { ok: boolean; detail: string } | undefined;
  let proxyHost: { ok: boolean; detail: string } | undefined;
  let stray: number;
  try {
    if (control.ok) {
      const port = listeners.ctx.tcpPort;
      proxy = await runProxyControl(opts, listeners, PROXY_CONTROL_ID, `127.0.0.1:${port}`, proxyConnectJs(PROXY_CONTROL_ID, port));
      socks = await runProxyControl(opts, listeners, SOCKS_CONTROL_ID, `127.0.0.1:${port}`, socksConnectJs(SOCKS_CONTROL_ID, port));
      proxyHost = await runProxyControl(opts, listeners, HOST_CONTROL_ID, `localhost:${port}`, proxyConnectJs(HOST_CONTROL_ID, port, { host: "localhost" }));
      listeners.ctx.proxyControl = proxy;
      listeners.ctx.socksControl = socks;
      listeners.ctx.hostControl = proxyHost;
    }
    for (const spec of CANARY_SPECS) {
      opts.onCanary?.(spec.id);
      if (!control.ok) {
        canaries.push({ id: spec.id, scope: CANARY_TECHNIQUES.find((t) => t.id === spec.id)!.scope, result: "inconclusive", detail: "not run: the control canary failed" });
        continue;
      }
      canaries.push(await runCanary(opts, spec, listeners));
    }
    // Let a late connection land before counting what no window explains.
    await new Promise((resolve) => setTimeout(resolve, 200));
    stray = strayConnections(listeners.ctx.connections, new Set([PROXY_CONTROL_ID, SOCKS_CONTROL_ID, HOST_CONTROL_ID, ...CANARY_SPECS.map((s) => s.id)]));
  } finally {
    await listeners.close();
    fs.rmSync(listenerDir, { recursive: true, force: true });
  }
  const controlOk = control.ok && stray === 0;
  const controlDetail = stray > 0 ? `${stray} connection(s) reached a listener outside every canary window, so the run cannot attribute them (${control.detail})` : control.detail;
  const unixBlocked = canaries.find((c) => c.id === "transport-unix-socket")?.result === "blocked";
  return {
    schema: PROBE_SCHEMA,
    host: opts.host,
    mechanism: {
      harness: "claude-code",
      runtime: "sandbox-runtime",
      runtimeVersion: opts.runtime.version,
      runtimeDigest: opts.runtime.digest,
      seccompHelperApplied: !opts.diagnostic && opts.runtime.seccompHelper !== null && controlOk && unixBlocked,
      mode: opts.diagnostic ? "diagnostic" : "policy",
      policyDigest: control.policyDigest,
      srtConfigDigest: control.srtConfigDigest,
      networkStrict: control.networkStrict,
      ...(opts.launch ? { launch: "gantry-admission-launch" as const } : {}),
    },
    control: { ok: controlOk, detail: controlDetail, ...(proxy ? { proxy } : {}), ...(socks ? { socks } : {}), ...(proxyHost ? { proxyHost } : {}) },
    canaries,
  };
}
