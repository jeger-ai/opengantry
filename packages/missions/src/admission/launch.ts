/**
 * `gantry admission launch -- <harness…>` (issue #356, MSN-0394): one broker for one harness run. It starts the broker
 * (the same `startBroker` as `gantry admission serve`, on its Unix socket outside the work tree, the git dir and the
 * state dir), runs the harness with `GANTRY_BROKER_SOCKET` naming that socket, and stops the broker once the harness has
 * exited. The harness's exit status is the launcher's (128+n for a harness killed by signal n).
 *
 * Signals. The harness runs in the launcher's process group, so a terminal's Ctrl-C already reaches it: the launcher
 * swallows SIGINT (passing it on would deliver it twice, and Claude Code exits on a second Ctrl-C) and keeps running
 * until the harness exits. SIGTERM and SIGHUP, which are usually sent to the launcher alone, are passed on. A signal
 * that arrives while the broker is still starting stops it before any harness runs; the launcher then exits 128+n.
 * A launcher killed with SIGKILL cannot clean up: remove `broker.lock`, `broker.json` and the socket by hand.
 *
 * The harness's MCP server reads the variable and relays (`relay.ts`). Sandboxed shell commands see the variable too,
 * but with srt's Unix-socket filter they cannot create a socket to connect with (owner decision 2026-11-17: every Unix
 * socket stays blocked in the sandbox).
 */
import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import { BrokerSetupError, startBroker, type ServeOptions } from "./serve.js";

type RunningBroker = Awaited<ReturnType<typeof startBroker>>;

const HANDLED: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
const FORWARDED = new Set<NodeJS.Signals>(["SIGTERM", "SIGHUP"]);

/** The shell convention for a process ended by `signal`: 128 + its number on this platform. */
function signalExitCode(signal: NodeJS.Signals): number {
  return 128 + (os.constants.signals[signal] ?? 0);
}

interface LaunchResult {
  exitCode: number;
  socket: string;
  brokerId: string;
  /** Set when a signal arrived during broker startup: no harness ran. */
  interrupted?: NodeJS.Signals;
}

/** Start the broker, run `command` under it, stop the broker; resolves with the harness's exit status. */
export async function launchWithBroker(opts: ServeOptions & { command: string[]; onReady?: (running: RunningBroker) => void }): Promise<LaunchResult> {
  const [file, ...args] = opts.command;
  if (file === undefined || file === "") throw new BrokerSetupError("config", "name the harness command after --, e.g. gantry admission launch … -- claude");
  // Installed before the broker starts and removed only after it is stopped: no signal kills the launcher holding the lock.
  let child: ChildProcess | null = null;
  let early: NodeJS.Signals | null = null;
  const onSignal = (sig: NodeJS.Signals): void => {
    if (child === null) early ??= sig;
    else if (FORWARDED.has(sig) && child.exitCode === null && child.signalCode === null) child.kill(sig);
  };
  for (const sig of HANDLED) process.on(sig, onSignal);
  try {
    const running = await startBroker(opts);
    const { plan, broker } = running;
    try {
      if (early !== null) return { exitCode: signalExitCode(early), socket: plan.socket, brokerId: broker.brokerId, interrupted: early };
      opts.onReady?.(running);
      const env = { ...(opts.env ?? process.env), GANTRY_BROKER_SOCKET: plan.socket };
      const exitCode = await new Promise<number>((resolve, reject) => {
        const proc = spawn(file, args, { cwd: plan.root, env, stdio: "inherit" });
        child = proc;
        proc.once("error", (err) => reject(new BrokerSetupError("config", `the harness command ${file} could not start: ${err.message}`)));
        proc.once("exit", (code, signal) => resolve(code ?? (signal ? signalExitCode(signal) : 1)));
      });
      return { exitCode, socket: plan.socket, brokerId: broker.brokerId };
    } finally {
      await running.close();
    }
  } catch (err) {
    // A startup that failed after a signal: what started is already released (`startBroker` cleans up on refusal).
    if (early !== null && child === null) return { exitCode: signalExitCode(early), socket: "", brokerId: "", interrupted: early };
    throw err;
  } finally {
    for (const sig of HANDLED) process.off(sig, onSignal);
  }
}
