/**
 * The broker as a local process (issue #356 slice 3, owner decision Q3): same OS user, outside the harness sandbox, on a
 * Unix domain socket. Linux only: the dispatchers need `/proc/self/fd` (held-handle `openat`/`fexecve` equivalents).
 *
 * Where things live:
 * - broker state (instance lock, `broker.json` with pid and socket) under the per-user state dir
 *   (`GANTRY_STATE_DIR`, default `~/.opengantry`) in `admission/<repo key>/`, which `gantry cage policy` denies;
 * - the journal under the git dir (`journal-file.ts`), which `gantry cage policy` denies too;
 * - the socket in its own directory, by default `$XDG_RUNTIME_DIR/opengantry/`, never inside the state dir, the git dir
 *   or the work tree. Whoever can connect may send a request; that is all a connection grants.
 *
 * Every byte from the socket is untrusted: one message per connection, at most `BROKER_MAX_MESSAGE_BYTES`, a strict
 * schema, and a deny (never a crash) for anything else. Once a message is handed to the broker, nothing more is read
 * from the connection and the only answer is the broker's own. Input refused before it became a request is counted per
 * window (`input-summary.ts`), never journaled per message.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { ADMISSION_HARNESSES, ADMISSION_PLATFORMS, type AdmissionHarness, type AdmissionPlatform } from "#core/schemas/admission-schema.js";
import { GANTRY_STATE_HOME_REL } from "#core/secret-paths.js";
import { AdmissionBroker, denialBudgetResponse, malformed, type BrokerConfig, type BrokerResponse } from "./broker.js";
import { AdmissionInputSummary, type InputRefusalKind } from "./input-summary.js";
import { AdmissionJournalFile, admissionJournalPath } from "./journal-file.js";

/** One message: a 64 KiB request plus the raw arguments it binds (file content up to 768 KiB, base64). */
const BROKER_MAX_MESSAGE_BYTES = 1024 * 1024 + 64 * 1024;
const CONNECTION_TIMEOUT_MS = 10_000;
/** sun_path is 108 bytes on Linux, NUL included. */
const MAX_SOCKET_PATH_BYTES = 107;

export class BrokerSetupError extends Error {
  constructor(
    readonly code: "unsupported" | "config" | "locked" | "journal" | "not_running",
    message: string,
  ) {
    super(message);
  }
}

/** The physical path, also for one that does not exist yet: the nearest existing ancestor resolved, the rest appended. */
function physicalPath(p: string): string {
  const missing: string[] = [];
  for (let cur = path.resolve(p); ; cur = path.dirname(cur)) {
    if (fs.existsSync(cur)) return path.join(fs.realpathSync(cur), ...missing);
    if (path.dirname(cur) === cur) return path.resolve(p);
    missing.unshift(path.basename(cur));
  }
}

const isUnder = (child: string, parent: string): boolean => {
  const rel = path.relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
};

/**
 * The host cell the broker runs in. Linux with `/proc/self/fd` only; the platform row is read from os-release, and an
 * operator may name it (`assumePlatform`, for test hosts) — which selects a row, never raises a level.
 */
export function resolveBrokerHost(input: {
  harness: string | undefined;
  assumePlatform?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  osRelease?: string | null;
  procFd?: boolean;
}): { platform: AdmissionPlatform; harness: AdmissionHarness } {
  const platform = input.platform ?? process.platform;
  if (platform !== "linux") throw new BrokerSetupError("unsupported", `the admission broker runs on Linux only (this is ${platform}): it needs Unix domain sockets and /proc/self/fd for held-handle dispatch`);
  if (!(input.procFd ?? fs.existsSync("/proc/self/fd"))) throw new BrokerSetupError("unsupported", "the admission broker needs /proc/self/fd (held-handle dispatch); it is not mounted here");
  if (!ADMISSION_HARNESSES.includes(input.harness as AdmissionHarness)) throw new BrokerSetupError("config", `--harness must be one of ${ADMISSION_HARNESSES.join(", ")}`);
  if (input.assumePlatform !== undefined) {
    if (!ADMISSION_PLATFORMS.includes(input.assumePlatform as AdmissionPlatform) || !input.assumePlatform.startsWith("ubuntu-")) {
      throw new BrokerSetupError("config", "--assume-platform must name a Linux platform row (ubuntu-26.04-x64)");
    }
    return { platform: input.assumePlatform as AdmissionPlatform, harness: input.harness as AdmissionHarness };
  }
  const release = input.osRelease === undefined ? readOsRelease() : input.osRelease;
  const field = (k: string): string | undefined => release?.match(new RegExp(`^${k}="?([^"\\n]*)"?$`, "m"))?.[1];
  if (field("ID") === "ubuntu" && field("VERSION_ID") === "26.04" && (input.arch ?? process.arch) === "x64") return { platform: "ubuntu-26.04-x64", harness: input.harness as AdmissionHarness };
  throw new BrokerSetupError("unsupported", "no capability row for this Linux host (rows: ubuntu-26.04-x64); pass --assume-platform to select one explicitly");
}

function readOsRelease(): string | null {
  try {
    return fs.readFileSync("/etc/os-release", "utf8");
  } catch {
    return null;
  }
}

/** `admission/<key>` under the per-user state dir; `key` names the repository's git dir. Never inside the work tree. */
export function brokerStateDir(root: string, gitDir: string, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.GANTRY_STATE_DIR?.trim() || path.join(os.homedir(), GANTRY_STATE_HOME_REL);
  if (!path.isAbsolute(configured)) throw new BrokerSetupError("config", "the state dir (GANTRY_STATE_DIR) must be an absolute path");
  const dir = physicalPath(configured);
  if (isUnder(dir, physicalPath(root))) throw new BrokerSetupError("config", "the state dir is inside the repository, where the candidate can reach it");
  const key = crypto.createHash("sha256").update(physicalPath(gitDir)).digest("hex").slice(0, 16);
  return path.join(dir, "admission", key);
}

/** The default socket: `$XDG_RUNTIME_DIR/opengantry/admission-<key>.sock`. */
export function defaultBrokerSocket(stateDir: string, env: NodeJS.ProcessEnv = process.env): string {
  const runtime = env.XDG_RUNTIME_DIR?.trim();
  if (!runtime || !path.isAbsolute(runtime)) throw new BrokerSetupError("config", "XDG_RUNTIME_DIR is not set; pass --socket <path> outside the repository, the git dir and the state dir");
  return path.join(runtime, "opengantry", `admission-${path.basename(stateDir)}.sock`);
}

interface ServeOptions {
  root: string;
  harness: string | undefined;
  contractDigest: string | undefined;
  policy?: string;
  socket?: string;
  assumePlatform?: string;
  env?: NodeJS.ProcessEnv;
  spawnTimeoutMs?: number;
  journalMaxBytes?: number;
  journalDenialMaxBytes?: number;
  /** How long a connection may take to deliver its message (tests lower it). Never applies once the message started. */
  connectionTimeoutMs?: number;
  summaryWindowMs?: number;
}

interface BrokerPlan {
  root: string;
  gitDir: string;
  stateDir: string;
  socket: string;
  policyFile: string;
  journalFile: string;
  host: BrokerConfig["host"];
  contractDigest: string;
}

/** Resolve and check every location before anything is created. Refuses rather than guesses. */
function planBroker(opts: ServeOptions): BrokerPlan {
  const env = opts.env ?? process.env;
  const host = resolveBrokerHost({ harness: opts.harness, assumePlatform: opts.assumePlatform });
  if (!/^[0-9a-f]{64}$/.test(opts.contractDigest ?? "")) throw new BrokerSetupError("config", "--contract-digest must be the sha256 (64 hex) of the accepted contract every request binds");
  const root = physicalPath(opts.root);
  const journalFile = admissionJournalPath(root);
  if (journalFile === null) throw new BrokerSetupError("config", "not a git repository: the journal lives under the git dir");
  const gitDir = path.dirname(path.dirname(path.dirname(journalFile)));
  const stateDir = brokerStateDir(root, gitDir, env);
  const policyFile = physicalPath(opts.policy ?? path.join(path.dirname(path.dirname(stateDir)), "admission", "policy.json"));
  if (isUnder(policyFile, root)) throw new BrokerSetupError("config", "the policy file is inside the work tree, where the candidate can edit it; keep it outside (default: the state dir)");
  if (!fs.existsSync(policyFile)) throw new BrokerSetupError("config", `no admission policy at ${policyFile} (opengantry.admission-policy.v1); pass --policy <file>`);
  const pst = fs.statSync(policyFile);
  if (!pst.isFile() || pst.uid !== process.getuid?.() || (pst.mode & 0o022) !== 0) {
    throw new BrokerSetupError("config", `the policy file ${policyFile} must be a regular file owned by this user and not group or world writable`);
  }
  const socket = physicalPath(opts.socket ?? defaultBrokerSocket(stateDir, env));
  if (!path.isAbsolute(socket)) throw new BrokerSetupError("config", "--socket must be an absolute path");
  for (const [name, dir] of [["work tree", root], ["git dir", gitDir], ["state dir", path.dirname(path.dirname(stateDir))]] as const) {
    if (isUnder(socket, dir)) throw new BrokerSetupError("config", `the socket must not be inside the ${name} (${dir})`);
  }
  if (Buffer.byteLength(socket) > MAX_SOCKET_PATH_BYTES) throw new BrokerSetupError("config", `the socket path is longer than ${MAX_SOCKET_PATH_BYTES} bytes; pass a shorter --socket`);
  return { root, gitDir, stateDir, socket, policyFile, journalFile, host, contractDigest: opts.contractDigest! };
}

/**
 * The broker's directories under the state dir (`admission/` and `admission/<key>/`): created 0700; an existing one
 * owned by this user is narrowed to 0700, and one owned by someone else, or a symlink, refuses.
 */
function prepareStateDir(stateDir: string): void {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  for (const dir of [path.dirname(stateDir), stateDir]) {
    const st = fs.lstatSync(dir);
    if (!st.isDirectory() || st.uid !== process.getuid?.()) throw new BrokerSetupError("config", `the state dir ${dir} must be a directory owned by this user`);
    if ((st.mode & 0o077) !== 0) fs.chmodSync(dir, 0o700);
  }
}

/** This process's start time in clock ticks since boot (`/proc/self/stat` field 22): with the pid, names one process. */
function processStartTime(pid: number | "self"): string | null {
  try {
    const stat = fs.readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
  } catch {
    return null;
  }
}

function processCmdline(pid: number | "self"): string | null {
  try {
    return fs.readFileSync(`/proc/${String(pid)}/cmdline`, "utf8");
  } catch {
    return null;
  }
}

/** The instance lock: created exclusively, with no stale takeover. A crashed broker's lock is removed by the operator. */
function acquireInstanceLock(stateDir: string, info: object): { release: () => void } {
  prepareStateDir(stateDir);
  const lock = path.join(stateDir, "broker.lock");
  const owner = `${JSON.stringify({ token: crypto.randomUUID(), pid: process.pid })}\n`;
  try {
    fs.writeFileSync(lock, owner, { flag: "wx", mode: 0o600 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    throw new BrokerSetupError("locked", `another admission broker holds ${lock}, or one crashed holding it; delete it (and its socket) only if no broker is running`);
  }
  const infoFile = path.join(stateDir, "broker.json");
  // pid, start time and full command line name this one process: `stop` signals nothing else (a recycled pid).
  fs.writeFileSync(infoFile, `${JSON.stringify({ ...info, pid: process.pid, startTime: processStartTime("self"), cmdline: processCmdline("self") })}\n`, { mode: 0o600 });
  return {
    release: () => {
      fs.rmSync(infoFile, { force: true });
      try {
        if (fs.readFileSync(lock, "utf8") === owner) fs.rmSync(lock);
      } catch {
        /* removed by hand */
      }
    },
  };
}

/** A socket directory only this user can enter, created 0700; an existing one must be ours and not group/world-writable. */
function prepareSocketDir(socket: string): void {
  const dir = path.dirname(socket);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.uid !== process.getuid?.() || (st.mode & 0o022) !== 0) {
    throw new BrokerSetupError("config", `the socket directory ${dir} must be a directory owned by this user and not group or world writable`);
  }
  if (fs.existsSync(socket)) throw new BrokerSetupError("locked", `${socket} exists: another broker is listening, or one crashed; remove it only if no broker is running`);
}

function parseMessage(buf: Buffer): unknown {
  const text = buf.toString("utf8");
  const line = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (line.includes("\n")) return Symbol.for("multiple");
  try {
    return JSON.parse(line);
  } catch {
    return Symbol.for("not-json");
  }
}

/**
 * Serve one connection: read one message within the bound, answer once, close. Never throws into the server.
 *
 * Before the message starts (its newline, or the end of input), the connection may be refused: timed out, oversized or
 * malformed, each counted in `summary`. Once it starts, the timeout is off and every further byte is read and dropped:
 * the only answer is the broker's own, however long the dispatch takes.
 */
function serveConnection(socket: net.Socket, broker: AdmissionBroker, host: BrokerConfig["host"], summary: AdmissionInputSummary, timeoutMs: number): void {
  const chunks: Buffer[] = [];
  let size = 0;
  let answered = false;
  // Set before the broker is called: a message is handled once, whether its newline or the end arrives first.
  let started = false;
  socket.on("error", () => socket.destroy());
  /** Answer once; the connection is dropped after the answer is flushed (`close`), or when the client lingers. */
  const answer = (response: BrokerResponse, close = false): void => {
    if (answered) return;
    answered = true;
    socket.setTimeout(timeoutMs, () => socket.destroy());
    socket.end(`${JSON.stringify(response)}\n`, () => {
      if (close) socket.destroy();
    });
  };
  const refuse = (kind: InputRefusalKind, response: BrokerResponse): void => {
    summary.note(kind);
    answer(response, true);
  };
  if (broker.denialBudgetExhausted) {
    socket.resume();
    refuse("denial_budget_exhausted", denialBudgetResponse());
    return;
  }
  socket.setTimeout(timeoutMs, () => {
    if (started) return;
    if (answered) socket.destroy();
    else refuse("timed_out", malformed("timed out waiting for a complete message", host));
  });
  const start = (): void => {
    if (answered || started) return;
    started = true;
    socket.setTimeout(0);
    const message = parseMessage(Buffer.concat(chunks));
    chunks.length = 0;
    if (typeof message === "symbol") return refuse("malformed", malformed(message === Symbol.for("multiple") ? "one message per connection" : "the message is not JSON", host));
    broker.handle(message).then(
      (response) => {
        // Malformed input has no ids and no receipt: counted here, never journaled.
        if (response.refusal === "request_malformed" && (response.receipts?.length ?? 0) === 0) summary.note("malformed");
        if (response.refusal === "denial_budget_exhausted") summary.note("denial_budget_exhausted");
        answer(response);
      },
      (err: unknown) => answer(malformed(`internal error: ${err instanceof Error ? err.message : String(err)}`, host)),
    );
  };
  socket.on("data", (chunk: Buffer) => {
    // After the message started (or was refused) input is drained and dropped, never parsed or answered.
    if (answered || started) return;
    size += chunk.length;
    if (size > BROKER_MAX_MESSAGE_BYTES) {
      chunks.length = 0;
      refuse("oversized", malformed(`the message exceeds ${BROKER_MAX_MESSAGE_BYTES} bytes`, host));
      return;
    }
    chunks.push(chunk);
    if (chunk.includes(0x0a)) start();
  });
  socket.on("end", start);
}

/** `exec/` in the broker's state dir: where `process.spawn` writes its private copy of an executable. Emptied at start. */
function preparePrivateDir(stateDir: string): string {
  const dir = path.join(stateDir, "exec");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { mode: 0o700 });
  return dir;
}

interface RunningBroker {
  broker: AdmissionBroker;
  plan: BrokerPlan;
  close: () => Promise<void>;
}

/** Start the broker: plan, lock, open and recover the journal, then listen. Every step refuses on doubt. */
export async function startBroker(opts: ServeOptions): Promise<RunningBroker> {
  const plan = planBroker(opts);
  const lock = acquireInstanceLock(plan.stateDir, { socket: plan.socket, root: plan.root });
  let server: net.Server | null = null;
  try {
    prepareSocketDir(plan.socket);
    let opened: ReturnType<typeof AdmissionJournalFile.open>;
    try {
      opened = AdmissionJournalFile.open(plan.journalFile, {
        ...(opts.journalMaxBytes === undefined ? {} : { maxBytes: opts.journalMaxBytes }),
        ...(opts.journalDenialMaxBytes === undefined ? {} : { denialMaxBytes: opts.journalDenialMaxBytes }),
      });
    } catch (err) {
      throw new BrokerSetupError("journal", err instanceof Error ? err.message : String(err));
    }
    const broker = new AdmissionBroker({
      root: plan.root,
      host: plan.host,
      policyFile: plan.policyFile,
      acceptedContractDigest: plan.contractDigest,
      journal: opened.journal,
      journalRecords: opened.records,
      privateDir: preparePrivateDir(plan.stateDir),
      ...(opts.spawnTimeoutMs === undefined ? {} : { spawnTimeoutMs: opts.spawnTimeoutMs }),
    });
    const summary = new AdmissionInputSummary(plan.journalFile, opts.summaryWindowMs === undefined ? {} : { windowMs: opts.summaryWindowMs });
    summary.start();
    const timeoutMs = opts.connectionTimeoutMs ?? CONNECTION_TIMEOUT_MS;
    const srv = net.createServer({ allowHalfOpen: true }, (s) => serveConnection(s, broker, plan.host, summary, timeoutMs));
    server = srv;
    const oldMask = process.umask(0o177);
    try {
      await new Promise<void>((resolve, reject) => {
        srv.once("error", reject);
        srv.listen(plan.socket, () => resolve());
      });
    } finally {
      process.umask(oldMask);
    }
    fs.chmodSync(plan.socket, 0o600);
    const close = async (): Promise<void> => {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
      summary.stop();
      fs.rmSync(plan.socket, { force: true });
      lock.release();
    };
    return { broker, plan, close };
  } catch (err) {
    server?.close();
    lock.release();
    throw err;
  }
}

/** `gantry admission stop`: signal the broker named in this repository's `broker.json` (same user only). */
export function stopBroker(root: string, env: NodeJS.ProcessEnv = process.env): { pid: number; socket: string } {
  const journalFile = admissionJournalPath(physicalPath(root));
  if (journalFile === null) throw new BrokerSetupError("config", "not a git repository");
  const stateDir = brokerStateDir(physicalPath(root), path.dirname(path.dirname(path.dirname(journalFile))), env);
  let info: { pid?: unknown; socket?: unknown; startTime?: unknown; cmdline?: unknown };
  try {
    info = JSON.parse(fs.readFileSync(path.join(stateDir, "broker.json"), "utf8")) as typeof info;
  } catch {
    throw new BrokerSetupError("not_running", "no admission broker is recorded for this repository");
  }
  if (!Number.isSafeInteger(info.pid) || (info.pid as number) <= 1) throw new BrokerSetupError("not_running", "broker.json names no valid pid");
  // A recycled pid must not be signalled: the process must be the very one that wrote broker.json (same start time and
  // the same full command line), not another repository's broker or any other process that got the pid.
  const pid = info.pid as number;
  const cmdline = processCmdline(pid);
  const startTime = processStartTime(pid);
  const same = typeof info.startTime === "string" && startTime === info.startTime && typeof info.cmdline === "string" && cmdline === info.cmdline && cmdline.includes("\0admission\0serve\0");
  if (!same) {
    throw new BrokerSetupError("not_running", `the recorded broker (pid ${String(info.pid)}) is not running; remove broker.lock, broker.json and its socket if no broker runs`);
  }
  try {
    process.kill(info.pid as number, "SIGTERM");
  } catch {
    throw new BrokerSetupError("not_running", `the recorded broker (pid ${String(info.pid)}) is not running; remove broker.lock, broker.json and its socket if no broker runs`);
  }
  return { pid: info.pid as number, socket: String(info.socket) };
}
