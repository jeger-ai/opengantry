import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { canonicalJson } from "#core/canonical-json.js";
import { CANARY_TECHNIQUES, PROBE_SCHEMA, type CanaryOutcome, type ProbeHost, type ProbeRecord } from "#core/admission-canary.js";
import { CANARY_SPECS, assertSpecsComplete, canaryScript, judgeCanary, snapshotTargets, type CanaryContext, type CanarySpec } from "./canaries.js";
import { makeFixture, removeFixture, type Fixture } from "./fixture.js";
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
  /** Called before each canary runs, for progress output. */
  onCanary?: (id: string) => void;
}

const sha = (text: string): string => crypto.createHash("sha256").update(text, "utf8").digest("hex");
const RUN_TIMEOUT_MS = 90_000;

interface Listeners {
  ctx: CanaryContext;
  current: { id: string };
  close: () => Promise<void>;
}

async function openListeners(dir: string): Promise<Listeners> {
  const current = { id: "" };
  const connections = new Map<string, number>();
  const count = (s: net.Socket): void => {
    connections.set(current.id, (connections.get(current.id) ?? 0) + 1);
    s.on("error", () => {});
    s.resume();
  };
  const tcp = net.createServer(count);
  const unix = net.createServer(count);
  const unixSocket = path.join(dir, "outside.sock");
  await new Promise<void>((resolve) => tcp.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => unix.listen(unixSocket, resolve));
  const tcpPort = (tcp.address() as net.AddressInfo).port;
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  const hasUserBus = !!runtimeDir && fs.existsSync(path.join(runtimeDir, "bus")) && onPath("systemd-run");
  const ctx: CanaryContext = { connections, tcpPort, unixSocket, hasPython: onPath("python3"), hasUserBus };
  const close = async (): Promise<void> => {
    await Promise.all([tcp, unix].map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  };
  return { ctx, current, close };
}

function onPath(cmd: string): boolean {
  return (process.env.PATH ?? "").split(path.delimiter).some((d) => d !== "" && fs.existsSync(path.join(d, cmd)));
}

/** The sandboxed command's environment: the fixture's home and state dir, the user's PATH and session bus. */
function sandboxEnv(fx: Fixture): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "", HOME: fx.home, TMPDIR: fx.tmp, GANTRY_STATE_DIR: fx.stateEnv, LANG: "C.UTF-8" };
  for (const k of ["USER", "LOGNAME", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"]) if (process.env[k]) env[k] = process.env[k];
  return env;
}

interface Prepared {
  fx: Fixture;
  policy: string;
  config: SrtConfig;
  configPath: string;
}

function prepare(opts: ProbeOptions, npm: boolean): Prepared {
  const fx = makeFixture({ npm });
  try {
    const policy = opts.generatePolicy(fx.repo, { HOME: fx.home, GANTRY_STATE_DIR: fx.stateEnv });
    const config = claudeSettingsToSrtConfig(JSON.parse(policy) as unknown, { tmpDir: fx.tmp, diagnostic: opts.diagnostic });
    const configPath = path.join(fx.base, "srt-settings.json");
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    return { fx, policy, config, configPath };
  } catch (err) {
    removeFixture(fx);
    throw err;
  }
}

function runInSandbox(opts: ProbeOptions, p: Prepared, script: string, inheritFd?: string): Promise<{ status: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const fd = inheritFd ? fs.openSync(inheritFd, "a") : null;
    const child = spawn(process.execPath, [opts.runtime.cli, "-s", p.configPath, "-c", script], {
      cwd: p.fx.repo,
      env: sandboxEnv(p.fx),
      stdio: ["ignore", "ignore", "pipe", ...(fd !== null ? [fd] : [])],
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

async function runControl(opts: ProbeOptions): Promise<{ ok: boolean; detail: string; policyDigest: string; srtConfigDigest: string; networkStrict: boolean }> {
  const p = prepare(opts, false);
  try {
    const r = await runInSandbox(opts, p, "echo CONTROL > out/control.txt && cat README.txt > out/control-read.txt");
    const wrote = fs.existsSync(path.join(p.fx.out, "control.txt")) && fs.readFileSync(path.join(p.fx.out, "control.txt"), "utf8").trim() === "CONTROL";
    const read = fs.existsSync(path.join(p.fx.out, "control-read.txt")) && fs.readFileSync(path.join(p.fx.out, "control-read.txt"), "utf8").trim() === "readable";
    const firstErr = normalized(r.stderr, p.fx).split("\n").find((l) => l.trim() !== "")?.slice(0, 200) ?? `exit ${String(r.status)}`;
    const settings = JSON.parse(p.policy) as { sandbox?: { network?: { strictAllowlist?: unknown } } };
    return {
      ok: wrote && read,
      detail: wrote && read ? "the sandboxed control wrote and read inside the workspace" : `the sandbox did not run the control: ${firstErr}`,
      policyDigest: sha(normalized(p.policy, p.fx)),
      srtConfigDigest: sha(normalized(canonicalJson(p.config), p.fx)),
      networkStrict: settings.sandbox?.network?.strictAllowlist === true,
    };
  } finally {
    removeFixture(p.fx);
  }
}

async function runCanary(opts: ProbeOptions, spec: CanarySpec, l: Listeners): Promise<CanaryOutcome> {
  const scope = CANARY_TECHNIQUES.find((t) => t.id === spec.id)!.scope;
  if (spec.applicable && !spec.applicable(l.ctx)) return { id: spec.id, scope, result: "not-applicable", detail: "this host lacks what the canary needs" };
  const p = prepare(opts, spec.npm === true);
  try {
    const before = snapshotTargets(spec, p.fx);
    l.current.id = spec.id;
    await runInSandbox(opts, p, canaryScript(spec, p.fx, l.ctx), spec.inheritFd?.(p.fx));
    await new Promise((resolve) => setTimeout(resolve, 50));
    l.current.id = "";
    return { id: spec.id, scope, ...judgeCanary(spec, p.fx, l.ctx, before) };
  } finally {
    removeFixture(p.fx);
  }
}

export async function runSandboxProbe(opts: ProbeOptions): Promise<ProbeRecord> {
  assertSpecsComplete();
  const control = await runControl(opts);
  const listenerDir = fs.mkdtempSync(path.join(fs.existsSync("/tmp") ? "/tmp" : path.dirname(opts.runtime.root), "og-canary-sock-"));
  const listeners = await openListeners(listenerDir);
  const canaries: CanaryOutcome[] = [];
  try {
    for (const spec of CANARY_SPECS) {
      opts.onCanary?.(spec.id);
      if (!control.ok) {
        canaries.push({ id: spec.id, scope: CANARY_TECHNIQUES.find((t) => t.id === spec.id)!.scope, result: "inconclusive", detail: "not run: the control canary failed" });
        continue;
      }
      canaries.push(await runCanary(opts, spec, listeners));
    }
  } finally {
    await listeners.close();
    fs.rmSync(listenerDir, { recursive: true, force: true });
  }
  return {
    schema: PROBE_SCHEMA,
    host: opts.host,
    mechanism: {
      harness: "claude-code",
      runtime: "sandbox-runtime",
      runtimeVersion: opts.runtime.version,
      runtimeDigest: opts.runtime.digest,
      seccompHelper: !opts.diagnostic && opts.runtime.seccompHelper !== null,
      mode: opts.diagnostic ? "diagnostic" : "policy",
      policyDigest: control.policyDigest,
      srtConfigDigest: control.srtConfigDigest,
      networkStrict: control.networkStrict,
    },
    control: { ok: control.ok, detail: control.detail },
    canaries,
  };
}
