import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { admissionCapabilityReport, capabilityLevelCounts } from "#core/admission-capabilities.js";
import { judgeProbe, probeDigest, probedCapabilityReport, type ProbeRecord } from "#core/admission-canary.js";
import type { AdmissionCapabilityReport } from "#core/schemas/admission-schema.js";
import { GantryUserError } from "#core/user-error.js";
import { getRepoRoot } from "#git/git.js";
import { APPARMOR_HINT, collectHostFacts, sandboxPrerequisite } from "#cage/sandbox-probe/host.js";
import { runSandboxProbe } from "#cage/sandbox-probe/probe.js";
import { resolveSandboxRuntime } from "#cage/sandbox-probe/runtime.js";
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
export async function runAdmissionCapabilities(opts: { json?: boolean; probe?: boolean; runtime?: string }): Promise<void> {
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
    const record = await probeHost({ runtime: opts.runtime, diagnostic: false, quiet: opts.json === true });
    const report = probedCapabilityReport(admissionCapabilityReport(), record);
    return {
      json: report,
      human: [`gantry admission capabilities (probed on this host, ${probeDigest(record).slice(0, 12)}): ${report.rows.length} cells (${summary(report)})`, ...report.rows.map((r) => `${r.capabilityId}: ${r.level}`)],
    };
  });
}

/** The policy the canaries run under: this very CLI's `gantry cage policy --agent claude-code`, for the fixture. */
function generatePolicy(repo: string, env: NodeJS.ProcessEnv): string {
  const cli = fileURLToPath(new URL("../index.js", import.meta.url));
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
  delete childEnv.GIT_DIR;
  delete childEnv.GIT_WORK_TREE;
  const r = spawnSync(process.execPath, [cli, "cage", "policy", "--agent", "claude-code", "--contract", "verify.yaml"], { cwd: repo, env: childEnv, encoding: "utf8" });
  if (r.status !== 0) throw new GantryUserError("GXT_ADMISSION_PROBE_UNAVAILABLE", `admission probe: gantry cage policy failed: ${r.stderr.trim().split("\n")[0] ?? ""}`, undefined, 1);
  return r.stdout;
}

async function probeHost(opts: { runtime?: string; diagnostic: boolean; quiet: boolean }): Promise<ProbeRecord> {
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
    generatePolicy,
    onCanary: opts.quiet ? undefined : (id) => logInfo(`  canary ${id}`),
  });
}

/**
 * `gantry admission probe` (hidden; MSN-0391, ADR-0063 decision 1): run the sandbox canaries on this host with the
 * policy `gantry cage policy --agent claude-code` generates and print each result, the family verdicts and the cells.
 * Refuses where the sandbox prerequisite is missing. `--diagnostic` runs the runtime without its seccomp helper, as
 * Claude Code does where the helper is missing; it can never yield `prevention`.
 */
export async function runAdmissionProbe(opts: { json?: boolean; runtime?: string; diagnostic?: boolean }): Promise<void> {
  await runUserCommandAsync({ json: opts.json }, async () => {
    const record = await probeHost({ runtime: opts.runtime, diagnostic: opts.diagnostic === true, quiet: opts.json === true });
    const verdicts = judgeProbe(record);
    const report = probedCapabilityReport(admissionCapabilityReport(), record);
    const digest = probeDigest(record);
    const h = record.host;
    const m = record.mechanism;
    return {
      json: { probe: record, probeDigest: digest, verdicts, report },
      human: [
        `gantry admission probe: claude-code sandbox on ${h.osRelease} (${h.arch}, kernel ${h.kernel}, bwrap ${h.bwrap ?? "none"}, socat ${h.socat ?? "none"}, apparmor_restrict_unprivileged_userns ${h.apparmorRestrictUserns})`,
        `runtime: @anthropic-ai/sandbox-runtime ${m.runtimeVersion} (${m.runtimeDigest.slice(0, 12)}), mode ${m.mode}, seccomp helper ${m.seccompHelper ? "on" : "off"}`,
        `control: ${record.control.ok ? "ok" : "FAILED"}: ${record.control.detail}`,
        ...record.canaries.map((c) => `  ${c.result === "blocked" ? "ok  " : c.result === "not-applicable" ? "n/a " : "FAIL"} ${c.id} (${c.scope}): ${c.result}: ${c.detail}`),
        ...verdicts.map((v) => `${v.family}: ${v.level === "prevention" ? "prevention" : `not proven (${v.reasons[0] ?? ""}${v.reasons.length > 1 ? `; +${v.reasons.length - 1} more` : ""})`}`),
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
      running = await startBroker({ root: getRepoRoot(), harness: opts.harness, contractDigest: opts.contractDigest, policy: opts.policy, socket: opts.socket, assumePlatform: opts.assumePlatform });
    } catch (e) {
      throw asUserError(e, "serve");
    }
    const { plan, broker } = running;
    const ready = { status: "listening", socket: plan.socket, broker_id: broker.brokerId, host: plan.host, journal: plan.journalFile, state_dir: plan.stateDir, policy: plan.policyFile };
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
