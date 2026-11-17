/**
 * `gantry admission launch -- <harness…>` (issue #356, MSN-0394): one broker for one harness run. It starts the broker
 * (the same `startBroker` as `gantry admission serve`, on its Unix socket outside the work tree, the git dir and the
 * state dir), runs the harness with `GANTRY_BROKER_SOCKET` naming that socket, passes SIGINT, SIGTERM and SIGHUP on to
 * the harness, and stops the broker once the harness has exited. The harness's exit status is the launcher's.
 *
 * The harness's MCP server reads the variable and relays (`relay.ts`). Sandboxed shell commands see the variable too,
 * but with srt's Unix-socket filter they cannot create a socket to connect with (owner decision 2026-11-17: every Unix
 * socket stays blocked in the sandbox).
 */
import { spawn } from "node:child_process";
import { BrokerSetupError, startBroker, type ServeOptions } from "./serve.js";

type RunningBroker = Awaited<ReturnType<typeof startBroker>>;

const FORWARDED: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
const SIGNAL_NUMBERS: Partial<Record<NodeJS.Signals, number>> = { SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };

interface LaunchResult {
  exitCode: number;
  socket: string;
  brokerId: string;
}

/** Start the broker, run `command` under it, stop the broker; resolves with the harness's exit status. */
export async function launchWithBroker(opts: ServeOptions & { command: string[]; onReady?: (running: RunningBroker) => void }): Promise<LaunchResult> {
  const [file, ...args] = opts.command;
  if (file === undefined || file === "") throw new BrokerSetupError("config", "name the harness command after --, e.g. gantry admission launch … -- claude");
  const running = await startBroker(opts);
  const { plan, broker } = running;
  try {
    opts.onReady?.(running);
    const env = { ...(opts.env ?? process.env), GANTRY_BROKER_SOCKET: plan.socket };
    const exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn(file, args, { cwd: plan.root, env, stdio: "inherit" });
      const forward = (sig: NodeJS.Signals): void => {
        child.kill(sig);
      };
      for (const sig of FORWARDED) process.on(sig, forward);
      const done = (): void => {
        for (const sig of FORWARDED) process.off(sig, forward);
      };
      child.once("error", (err) => {
        done();
        reject(new BrokerSetupError("config", `the harness command ${file} could not start: ${err.message}`));
      });
      child.once("exit", (code, signal) => {
        done();
        resolve(code ?? 128 + (signal ? (SIGNAL_NUMBERS[signal] ?? 1) : 1));
      });
    });
    return { exitCode, socket: plan.socket, brokerId: broker.brokerId };
  } finally {
    await running.close();
  }
}
