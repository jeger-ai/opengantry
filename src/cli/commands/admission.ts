import { admissionCapabilityReport, capabilityLevelCounts } from "#core/admission-capabilities.js";
import { GantryUserError } from "#core/user-error.js";
import { getRepoRoot } from "#git/git.js";
import { BrokerSetupError, startBroker, stopBroker } from "#missions/admission/serve.js";
import { logInfo, writeStdout } from "../output/cli-io.js";
import { runUserCommand, runUserCommandAsync } from "../output/command-boundary.js";

/**
 * `gantry admission capabilities` (hidden, read-only; ADR-0063, owner decision Q9): print the operation admission
 * capability matrix. No cell is `prevention`; the command reads no file and proves nothing about a host.
 */
export function runAdmissionCapabilities(opts: { json?: boolean }): void {
  runUserCommand({ json: opts.json }, () => {
    const report = admissionCapabilityReport();
    const counts = capabilityLevelCounts(report);
    const summary = Object.entries(counts)
      .map(([level, n]) => `${level} ${n}`)
      .join(", ");
    return {
      json: report,
      human: [`gantry admission capabilities: ${report.rows.length} cells (${summary})`, ...report.rows.map((r) => `${r.capabilityId}: ${r.level}`)],
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
