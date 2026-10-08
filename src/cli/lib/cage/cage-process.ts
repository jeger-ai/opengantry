import { spawn } from "node:child_process";
import os from "node:os";

export interface CageProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** Spawn failure (e.g. ENOENT); the command never ran. */
  spawnError: string | null;
}

/** Shell convention: a child killed by signal N exits 128 + N. */
export function signalExitCode(signal: NodeJS.Signals): number {
  const n = os.constants.signals[signal];
  return typeof n === "number" ? 128 + n : 1;
}

const FORWARDED_SIGNALS: readonly NodeJS.Signals[] = ["SIGTERM", "SIGHUP"];

/**
 * Run the caged command with inherited stdio so interactive agents keep their TTY.
 *
 * The cage must outlive the child to diff and revert, so while it runs:
 * - SIGINT is swallowed here; a terminal Ctrl-C already reaches the child through the
 *   shared process group, and forwarding it again would double-interrupt.
 * - SIGTERM / SIGHUP are forwarded to the child instead of killing the cage.
 */
export async function spawnCaged(argv: readonly string[], cwd: string): Promise<CageProcessResult> {
  const [command, ...args] = argv;
  const child = spawn(command!, args, { cwd, stdio: "inherit", env: process.env });
  const ignoreInt = (): void => {};
  const forward = (sig: NodeJS.Signals): void => {
    child.kill(sig);
  };
  process.on("SIGINT", ignoreInt);
  for (const sig of FORWARDED_SIGNALS) process.on(sig, forward);
  try {
    return await new Promise<CageProcessResult>((resolve) => {
      child.on("error", (err) => resolve({ code: null, signal: null, spawnError: err.message }));
      child.on("exit", (code, signal) => resolve({ code, signal, spawnError: null }));
    });
  } finally {
    process.off("SIGINT", ignoreInt);
    for (const sig of FORWARDED_SIGNALS) process.off(sig, forward);
  }
}
