import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import os from "node:os";

export interface CageProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** Spawn failure (e.g. ENOENT); the command never ran. */
  spawnError: string | null;
}

/** A running caged command: its exit promise and a tree-wide terminate for halts and trapped signals. */
export interface CageChild {
  pid: number | null;
  done: Promise<CageProcessResult>;
  /** SIGTERM the command and every descendant, wait `graceMs`, then SIGKILL whatever is left. */
  terminate(graceMs: number): Promise<void>;
  /** Resolves once any termination started by a halt or a trapped signal has finished (immediately when none). */
  settled(): Promise<void>;
  /** The signal the cage wrapper trapped and answered with `terminate`, or null. */
  trappedSignal: NodeJS.Signals | null;
}

export interface CageSpawnOptions {
  /** Grace between SIGTERM and SIGKILL when a trapped signal terminates the tree. */
  graceMs: number;
  /**
   * Ctrl-C semantics: when the cage runs on a terminal, SIGINT already reaches the command through the
   * shared foreground group (interactive agents use it to interrupt, not to quit), so the cage keeps
   * supervising instead of killing the tree. Off a terminal a SIGINT can only be aimed at the wrapper
   * itself and is treated like SIGTERM. Defaults to `process.stdin.isTTY`.
   */
  interactive?: boolean;
}

/** Shell convention: a child killed by signal N exits 128 + N. */
export function signalExitCode(signal: NodeJS.Signals): number {
  const n = os.constants.signals[signal];
  return typeof n === "number" ? 128 + n : 1;
}

/** Signals the wrapper traps: it must outlive the command to restore, so none of them may kill the cage. */
const TRAPPED_SIGNALS: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];

/**
 * Descendants of `pid` via one `ps` listing (POSIX; empty on Windows or when `ps` fails). Enumerated
 * rather than killed as a process group: the command keeps the terminal's foreground group so
 * interactive agents are not stopped by SIGTTIN (ADR-0048 decision 7).
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

/** Ref'd on purpose: during the grace period the dead child no longer keeps the event loop alive. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Start the caged command with inherited stdio so interactive agents keep their TTY. The command is not
 * spawned as its own process group (see {@link listDescendantPids}).
 *
 * The cage must outlive the child to diff and revert, so SIGINT, SIGTERM and SIGHUP are trapped here and
 * never end the wrapper. SIGTERM, SIGHUP and a non-interactive SIGINT terminate the whole enumerated tree
 * (SIGTERM, grace, SIGKILL); the normal exit path then restores the snapshot and removes the journal.
 * An interactive SIGINT (terminal Ctrl-C) is left to the command, which already received it.
 */
export function startCaged(
  argv: readonly string[],
  cwd: string,
  extraEnv: NodeJS.ProcessEnv = {},
  opts: CageSpawnOptions = { graceMs: 2000 },
): CageChild {
  const [command, ...args] = argv;
  const child = spawn(command!, args, { cwd, stdio: "inherit", env: { ...process.env, ...extraEnv } });
  const interactive = opts.interactive ?? process.stdin.isTTY === true;
  let exited = false;
  let pending: Promise<void> = Promise.resolve();

  const terminate = async (graceMs: number): Promise<void> => {
    if (exited) return;
    // The first listing is kept: once the command dies, its orphans are reparented and would be missed.
    const first = treeOf(child);
    signalPids(first, "SIGTERM");
    await sleep(graceMs);
    // Even when the command itself is gone by now, descendants that ignored SIGTERM may not be.
    if (process.platform === "win32" && child.pid && !exited) {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
      return;
    }
    signalPids(new Set([...treeOf(child), ...first]), "SIGKILL");
  };

  const result: CageChild = {
    pid: child.pid ?? null,
    done: Promise.resolve({ code: null, signal: null, spawnError: null }),
    trappedSignal: null,
    terminate(graceMs) {
      pending = pending.then(() => terminate(graceMs));
      return pending;
    },
    settled: () => pending,
  };

  const onSignal = (sig: NodeJS.Signals): void => {
    if (sig === "SIGINT" && interactive) return;
    result.trappedSignal ??= sig;
    void result.terminate(opts.graceMs);
  };
  for (const sig of TRAPPED_SIGNALS) process.on(sig, onSignal);

  result.done = new Promise<CageProcessResult>((resolve) => {
    const finish = (r: CageProcessResult): void => {
      exited = true;
      for (const sig of TRAPPED_SIGNALS) process.off(sig, onSignal);
      resolve(r);
    };
    child.on("error", (err) => finish({ code: null, signal: null, spawnError: err.message }));
    child.on("exit", (code, signal) => finish({ code, signal, spawnError: null }));
  });
  return result;
}

/** Run the caged command to completion (no halt). */
export async function spawnCaged(argv: readonly string[], cwd: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<CageProcessResult> {
  return startCaged(argv, cwd, extraEnv).done;
}
