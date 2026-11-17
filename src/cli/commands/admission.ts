import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { admissionCapabilityReport, capabilityLevelCounts } from "#core/admission-capabilities.js";
import { judgeBroker, judgeProbe, probeDigest, probedCapabilityReport, type ProbeRecord } from "#core/admission-canary.js";
import type { AdmissionCapabilityReport } from "#core/schemas/admission-schema.js";
import { GantryUserError } from "#core/user-error.js";
import { getRepoRoot } from "#git/git.js";
import { APPARMOR_HINT, collectHostFacts, sandboxPrerequisite } from "#cage/sandbox-probe/host.js";
import type { BrokerHandle } from "#cage/sandbox-probe/canaries.js";
import type { Fixture } from "#cage/sandbox-probe/fixture.js";
import { runSandboxProbe } from "#cage/sandbox-probe/probe.js";
import { resolveSandboxRuntime } from "#cage/sandbox-probe/runtime.js";
import { launchWithBroker } from "#missions/admission/launch.js";
import { BrokerSetupError, startBroker, stopBroker } from "#missions/admission/serve.js";
import { logInfo, writeStdout } from "../output/cli-io.js";
import { runUserCommand, runUserCommandAsync } from "../output/command-boundary.js";

function summary(report: AdmissionCapabilityReport): string {
  return Object.entries(capabilityLevelCounts(report))
    .map(([level, n]) => `${level} ${n}`)
    .join(", ");
}

/**
 * `gantry admission capabilities` (hidden, read-only; ADR-0063, owner decision Q9): print the operation admission
 * capability matrix. The default is the static matrix, which proves nothing about a host and has no `prevention`
 * cell. `--probe` runs the sandbox canaries on this host first and prints the matrix with their result (MSN-0391).
 */
export async function runAdmissionCapabilities(opts: { json?: boolean; probe?: boolean; runtime?: string; strictNetwork?: boolean }): Promise<void> {
  if (!opts.probe) {
    runUserCommand({ json: opts.json }, () => {
      const report = admissionCapabilityReport();
      return {
        json: report,
        human: [`gantry admission capabilities: ${report.rows.length} cells (${summary(report)})`, ...report.rows.map((r) => `${r.capabilityId}: ${r.level}`)],
      };
    });
    return;
  }
  await runUserCommandAsync({ json: opts.json }, async () => {
    const record = await probeHost({ runtime: opts.runtime, diagnostic: false, strictNetwork: opts.strictNetwork === true, quiet: opts.json === true });
    const report = probedCapabilityReport(admissionCapabilityReport(), record);
    return {
      json: report,
      human: [`gantry admission capabilities (probed on this host, ${probeDigest(record).slice(0, 12)}): ${report.rows.length} cells (${summary(report)})`, ...report.rows.map((r) => `${r.capabilityId}: ${r.level}`)],
    };
  });
}

const SELF_CLI = (): string => fileURLToPath(new URL("../index.js", import.meta.url));

/**
 * The policy the canaries run under: this very CLI's `gantry cage policy --agent claude-code`, for the fixture, with
 * `--strict-network` when the probe was asked for the strict policy (MSN-0395).
 */
function policyGenerator(strictNetwork: boolean) {
  return (repo: string, env: NodeJS.ProcessEnv): string => generatePolicy(repo, env, strictNetwork);
}

function generatePolicy(repo: string, env: NodeJS.ProcessEnv, strictNetwork: boolean): string {
  const cli = SELF_CLI();
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
  delete childEnv.GIT_DIR;
  delete childEnv.GIT_WORK_TREE;
  const args = [cli, "cage", "policy", "--agent", "claude-code", "--contract", "verify.yaml", ...(strictNetwork ? ["--strict-network"] : [])];
  const r = spawnSync(process.execPath, args, { cwd: repo, env: childEnv, encoding: "utf8" });
  if (r.status !== 0) throw new GantryUserError("GXT_ADMISSION_PROBE_UNAVAILABLE", `admission probe: gantry cage policy failed: ${r.stderr.trim().split("\n")[0] ?? ""}`, undefined, 1);
  return r.stdout;
}

/** A real broker for a broker canary: this CLI's `gantry admission serve`, outside the sandbox, for the fixture. */
function brokerLauncher(assumePlatform: boolean) {
  return (fx: Fixture, socket: string): Promise<{ handle: BrokerHandle; stop: () => Promise<void> }> =>
    new Promise((resolve, reject) => {
      const args = ["admission", "serve", "--harness", "claude-code", "--contract-digest", "0".repeat(64), "--policy", fx.brokerPolicy, "--socket", socket, "--json"];
      if (assumePlatform) args.push("--assume-platform", "ubuntu-26.04-x64");
      const child = spawn(process.execPath, [SELF_CLI(), ...args], { cwd: fx.repo, env: { ...process.env, HOME: fx.home, GANTRY_STATE_DIR: fx.stateEnv }, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      const exited = new Promise<void>((done) => child.once("exit", () => done()));
      const stop = async (): Promise<void> => {
        child.kill("SIGTERM");
        const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
        await exited;
        clearTimeout(timer);
      };
      const fail = (why: string): void => {
        void stop();
        reject(new Error(`admission serve did not start: ${why}`));
      };
      const timer = setTimeout(() => fail("no listening line within 15 s"), 15_000);
      child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (!out.includes("listening")) reject(new Error(`admission serve exited ${String(code)}: ${err.trim().split("\n")[0] ?? ""}`));
      });
      child.stdout.on("data", (d: Buffer) => {
        out += d.toString("utf8");
        const line = out.split("\n").find((l) => l.includes('"listening"'));
        if (!line) return;
        clearTimeout(timer);
        const ready = JSON.parse(line) as { journal: string; state_dir: string; policy: string };
        resolve({ handle: { socket, stateFiles: [ready.journal, path.join(ready.state_dir, "broker.json"), ready.policy], execDir: path.join(ready.state_dir, "exec") }, stop });
      });
    });
}

async function probeHost(opts: { runtime?: string; diagnostic: boolean; strictNetwork: boolean; quiet: boolean }): Promise<ProbeRecord> {
  const host = collectHostFacts();
  const prereq = sandboxPrerequisite(host);
  // A diagnostic run needs bwrap and socat but not the nested user namespace: it runs without the seccomp helper.
  const blocking = opts.diagnostic ? prereq.problems.filter((p) => !p.startsWith("a process inside bwrap")) : prereq.problems;
  if (blocking.length > 0) {
    throw new GantryUserError(
      "GXT_ADMISSION_PROBE_UNAVAILABLE",
      `admission probe: the sandbox cannot run on this host, so no cell can be proven: ${blocking.join("; ")}`,
      `${APPARMOR_HINT} The capability cells stay as the static matrix has them.`,
      1,
    );
  }
  const runtime = resolveSandboxRuntime(opts.runtime);
  return runSandboxProbe({
    runtime,
    host,
    diagnostic: opts.diagnostic,
    generatePolicy: policyGenerator(opts.strictNetwork),
    startBroker: brokerLauncher(host.platform === null),
    onCanary: opts.quiet ? undefined : (id) => logInfo(`  canary ${id}`),
  });
}

/** ok when the canary came out as wanted: blocked, except the broker socket, which must be reached. */
function canaryMark(c: ProbeRecord["canaries"][number]): string {
  if (c.result === "not-applicable") return "n/a ";
  const wanted = c.id === "broker-socket-reach" ? "effect" : "blocked";
  return c.result === wanted ? "ok  " : "FAIL";
}

/**
 * `gantry admission probe` (hidden; MSN-0391, ADR-0063 decision 1): run the sandbox canaries on this host with the
 * policy `gantry cage policy --agent claude-code` generates and print each result, the family verdicts and the cells.
 * Refuses where the sandbox prerequisite is missing. `--diagnostic` runs the runtime without its seccomp helper, as
 * Claude Code does where the helper is missing; it can never yield `prevention`. `--strict-network` probes the policy
 * `gantry cage policy --strict-network` generates, the only one under which `network.connect` can be proven.
 */
export async function runAdmissionProbe(opts: { json?: boolean; runtime?: string; diagnostic?: boolean; strictNetwork?: boolean }): Promise<void> {
  await runUserCommandAsync({ json: opts.json }, async () => {
    const record = await probeHost({ runtime: opts.runtime, diagnostic: opts.diagnostic === true, strictNetwork: opts.strictNetwork === true, quiet: opts.json === true });
    const verdicts = judgeProbe(record);
    const broker = judgeBroker(record);
    const report = probedCapabilityReport(admissionCapabilityReport(), record);
    const digest = probeDigest(record);
    const h = record.host;
    const m = record.mechanism;
    return {
      json: { probe: record, probeDigest: digest, verdicts, broker, report },
      human: [
        `gantry admission probe: claude-code sandbox on ${h.osRelease} (${h.arch}, kernel ${h.kernel}, bwrap ${h.bwrap ?? "none"}, socat ${h.socat ?? "none"}, apparmor_restrict_unprivileged_userns ${h.apparmorRestrictUserns})`,
        `runtime: @anthropic-ai/sandbox-runtime ${m.runtimeVersion} (${m.runtimeDigest.slice(0, 12)}), mode ${m.mode}, seccomp helper ${m.seccompHelperApplied ? "applied" : "not applied"}, network ${m.networkStrict ? "strict allowlist" : "prompt for new hosts"}`,
        `control: ${record.control.ok ? "ok" : "FAILED"}: ${record.control.detail}`,
        ...(record.control.proxy ? [`proxy control: ${record.control.proxy.ok ? "ok" : "FAILED"}: ${record.control.proxy.detail}`] : []),
        ...record.canaries.map((c) => `  ${canaryMark(c)} ${c.id} (${c.scope}): ${c.result}: ${c.detail}`),
        ...verdicts.map((v) => `${v.family}: ${v.level === "prevention" ? "prevention" : `not proven (${v.reasons[0] ?? ""}${v.reasons.length > 1 ? `; +${v.reasons.length - 1} more` : ""})`}`),
        `admission broker: socket ${broker.reachable === null ? "not tested" : broker.reachable ? "reachable" : "NOT reachable"}, state ${broker.stateProtected === null ? "not tested" : broker.stateProtected ? "protected" : "NOT protected"}${broker.proven ? " (proven)" : ""}`,
        `cells: ${summary(report)}; probe digest ${digest}`,
      ],
    };
  });
}

const SETUP_CODES: Record<BrokerSetupError["code"], string> = {
  unsupported: "GXT_ADMISSION_BROKER_UNSUPPORTED",
  config: "GXT_ADMISSION_BROKER_CONFIG_INVALID",
  locked: "GXT_ADMISSION_BROKER_LOCKED",
  journal: "GXT_ADMISSION_JOURNAL_INVALID",
  not_running: "GXT_ADMISSION_BROKER_NOT_RUNNING",
};

function asUserError(e: unknown, command: string): unknown {
  if (!(e instanceof BrokerSetupError)) return e;
  return new GantryUserError(SETUP_CODES[e.code], `admission ${command}: ${e.message}`, undefined, e.code === "config" ? 2 : 1);
}

interface ServeCliOptions {
  harness?: string;
  contractDigest?: string;
  policy?: string;
  hostConfig?: string;
  socket?: string;
  assumePlatform?: string;
  json?: boolean;
}

/**
 * `gantry admission serve` (hidden; ADR-0063 slice 3): run the admission broker on a Unix domain socket until SIGTERM
 * or SIGINT. SIGHUP revokes (a new epoch). Nothing here confines the candidate; every cell keeps its reported level.
 */
export async function runAdmissionServe(opts: ServeCliOptions): Promise<void> {
  await runUserCommandAsync({ json: opts.json }, async () => {
    let running: Awaited<ReturnType<typeof startBroker>>;
    try {
      running = await startBroker({ root: getRepoRoot(), harness: opts.harness, contractDigest: opts.contractDigest, policy: opts.policy, hostConfig: opts.hostConfig, socket: opts.socket, assumePlatform: opts.assumePlatform });
    } catch (e) {
      throw asUserError(e, "serve");
    }
    const { plan, broker } = running;
    const ready = { status: "listening", socket: plan.socket, broker_id: broker.brokerId, host: plan.host, journal: plan.journalFile, state_dir: plan.stateDir, policy: plan.policyFile, dispatched: broker.dispatchedFamilies };
    if (opts.json) writeStdout(JSON.stringify(ready));
    else logInfo(`gantry admission serve: listening on ${plan.socket} (broker ${broker.brokerId}, ${plan.host.platform}/${plan.host.harness}); journal ${plan.journalFile}`);
    const onHup = (): void => broker.revoke();
    process.on("SIGHUP", onHup);
    await new Promise<void>((resolve) => {
      process.once("SIGTERM", resolve);
      process.once("SIGINT", resolve);
    });
    process.off("SIGHUP", onHup);
    await running.close();
    return { json: { status: "stopped", broker_id: broker.brokerId }, human: `gantry admission serve: stopped broker ${broker.brokerId}` };
  });
}

/**
 * `gantry admission launch -- <harness…>` (hidden; MSN-0394): a broker for one harness run. The harness gets
 * GANTRY_BROKER_SOCKET, its MCP server relays through gxt_admission_request, and the broker stops when the harness exits.
 * Exits with the harness's status (128+n after signal n during startup). Nothing here confines the harness; every cell keeps its reported level.
 */
export async function runAdmissionLaunch(command: string[], opts: Omit<ServeCliOptions, "json">): Promise<void> {
  let exitCode: number | null = null;
  await runUserCommandAsync({}, async () => {
    try {
      const result = await launchWithBroker({
        root: getRepoRoot(),
        harness: opts.harness,
        contractDigest: opts.contractDigest,
        policy: opts.policy,
        socket: opts.socket,
        assumePlatform: opts.assumePlatform,
        command,
        onReady: ({ plan, broker }) => logInfo(`gantry admission launch: broker ${broker.brokerId} on ${plan.socket} (GANTRY_BROKER_SOCKET); journal ${plan.journalFile}`),
      });
      exitCode = result.exitCode;
      if (result.interrupted) return { json: { status: "interrupted", signal: result.interrupted, exit_code: result.exitCode }, human: `gantry admission launch: ${result.interrupted} during broker startup; no harness ran, the broker is stopped` };
      return { json: { status: "exited", exit_code: result.exitCode, broker_id: result.brokerId }, human: `gantry admission launch: harness exited ${result.exitCode}; broker ${result.brokerId} stopped` };
    } catch (e) {
      throw asUserError(e, "launch");
    }
  });
  // Only a harness that ran sets the status; a refusal keeps the code the command boundary set.
  if (exitCode !== null) process.exitCode = exitCode;
}

/** `gantry admission stop` (hidden): SIGTERM to the broker recorded for this repository. */
export function runAdmissionStop(opts: { json?: boolean }): void {
  runUserCommand({ json: opts.json }, () => {
    try {
      const stopped = stopBroker(getRepoRoot());
      return { json: { status: "stopping", pid: stopped.pid, socket: stopped.socket }, human: `gantry admission stop: sent SIGTERM to broker pid ${stopped.pid}` };
    } catch (e) {
      throw asUserError(e, "stop");
    }
  });
}
