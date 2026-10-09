import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import os from "node:os";

export interface CageProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** Spawn failure (e.g. ENOENT); the command never ran. */
  spawnError: string | null;
}

/** A running caged command: its exit promise and a tree-wide terminate for the contested-file halt. */
export interface CageChild {
  pid: number | null;
  done: Promise<CageProcessResult>;
  /** SIGTERM the command and every descendant, wait `graceMs`, then SIGKILL whatever is left. */
  terminate(graceMs: number): Promise<void>;
}

/** Shell convention: a child killed by signal N exits 128 + N. */
export function signalExitCode(signal: NodeJS.Signals): number {
  const n = os.constants.signals[signal];
  return typeof n === "number" ? 128 + n : 1;
}

const FORWARDED_SIGNALS: readonly NodeJS.Signals[] = ["SIGTERM", "SIGHUP"];

/**
 * Descendants of `pid` via one `ps` listing (POSIX; empty on Windows or when `ps` fails). Enumerated
 * rather than killed as a process group: the command keeps the terminal's foreground group so
 * interactive agents are not stopped by SIGTTIN.
 */
export function listDescendantPids(pid: number): number[] {
  if (process.platform === "win32") return [];
  const r = spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
  if (r.status !== 0) return [];
  const children = new Map<number, number[]>();
  for (const line of r.stdout.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!m) continue;
    const parent = Number(m[2]);
    children.set(parent, [...(children.get(parent) ?? []), Number(m[1])]);
  }
  const out: number[] = [];
  const queue = [pid];
  while (queue.length > 0) {
    for (const c of children.get(queue.shift()!) ?? []) {
      out.push(c);
      queue.push(c);
    }
  }
  return out;
}

function signalPids(pids: Iterable<number>, sig: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, sig);
    } catch {
      // already gone
    }
  }
}

/** Descendants first so a parent cannot respawn what was just signalled; the command itself last. */
function treeOf(child: ChildProcess): number[] {
  return child.pid ? [...listDescendantPids(child.pid), child.pid] : [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}

/**
 * Start the caged command with inherited stdio so interactive agents keep their TTY.
 *
 * The cage must outlive the child to diff and revert, so while it runs:
 * - SIGINT is swallowed here; a terminal Ctrl-C already reaches the child through the
 *   shared process group, and forwarding it again would double-interrupt.
 * - SIGTERM / SIGHUP are forwarded to the child instead of killing the cage.
 */
export function startCaged(argv: readonly string[], cwd: string, extraEnv: NodeJS.ProcessEnv = {}): CageChild {
  const [command, ...args] = argv;
  const child = spawn(command!, args, { cwd, stdio: "inherit", env: { ...process.env, ...extraEnv } });
  const ignoreInt = (): void => {};
  const forward = (sig: NodeJS.Signals): void => {
    child.kill(sig);
  };
  process.on("SIGINT", ignoreInt);
  for (const sig of FORWARDED_SIGNALS) process.on(sig, forward);
  let exited = false;
  const done = new Promise<CageProcessResult>((resolve) => {
    const finish = (result: CageProcessResult): void => {
      exited = true;
      process.off("SIGINT", ignoreInt);
      for (const sig of FORWARDED_SIGNALS) process.off(sig, forward);
      resolve(result);
    };
    child.on("error", (err) => finish({ code: null, signal: null, spawnError: err.message }));
    child.on("exit", (code, signal) => finish({ code, signal, spawnError: null }));
  });
  return {
    pid: child.pid ?? null,
    done,
    async terminate(graceMs) {
      if (exited) return;
      // The first listing is kept: once the command dies, its orphans are reparented and would be missed.
      const first = treeOf(child);
      signalPids(first, "SIGTERM");
      await sleep(graceMs);
      if (process.platform === "win32" && child.pid && !exited) {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
        return;
      }
      signalPids(new Set([...treeOf(child), ...first]), "SIGKILL");
    },
  };
}

/** Run the caged command to completion (no halt). */
export async function spawnCaged(argv: readonly string[], cwd: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<CageProcessResult> {
  return startCaged(argv, cwd, extraEnv).done;
}
