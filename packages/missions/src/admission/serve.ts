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
 * Every byte from the socket is untrusted: one message per connection (its first line, at most
 * `BROKER_MAX_MESSAGE_BYTES`), delivered within a deadline from accept, a strict schema, and a deny (never a crash) for
 * anything else. At most `BROKER_MAX_CONNECTIONS` connections are open at once; past that a new one is refused. Once a
 * message is handed to the broker, nothing more is read from the connection and the only answer is the broker's own.
 * Input refused before it became a request is counted per window (`input-summary.ts`), never journaled per message.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { ADMISSION_HARNESSES, ADMISSION_PLATFORMS, ADMISSION_SCHEMA_IDS, type AdmissionHarness, type AdmissionPlatform, type AdmissionReceipt } from "#core/schemas/admission-schema.js";
import { GANTRY_STATE_HOME_REL } from "#core/secret-paths.js";
import { AdmissionBroker, denialBudgetResponse, malformed, policyFileProblem, tooManyConnectionsResponse, type BrokerConfig, type BrokerResponse } from "./broker.js";
import { AdmissionInputSummary, type InputRefusalKind } from "./input-summary.js";
import { AdmissionJournalFile, admissionJournalPath } from "./journal-file.js";
import { admissionDigest } from "#core/admission.js";
import { formatSchemaIssues } from "#core/schemas/issues.js";
import { hostConfigSchema } from "./host-config.js";
import { brokerGitDir } from "./host-git-objects.js";
import { GitHubAppCredentialProvider, HostCredentialError } from "./host-credentials.js";
import type { HostBrokerContext } from "./host-dispatch.js";

/** One message: a 64 KiB request plus the raw arguments it binds (file content up to 768 KiB, base64). */
const BROKER_MAX_MESSAGE_BYTES = 1024 * 1024 + 64 * 1024;
/** A deadline from accept until the message's line is complete (not an idle timer: a trickling client is cut off). */
const CONNECTION_TIMEOUT_MS = 10_000;
/** Connections open at once; past it a new connection is refused at once (a long dispatch holds its connection). */
const BROKER_MAX_CONNECTIONS = 64;
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

export interface ServeOptions {
  root: string;
  harness: string | undefined;
  contractDigest: string | undefined;
  policy?: string;
  /** The host broker configuration (`opengantry.admission-host.v1`); without it `git.publish` and `delivery.mutate` stay unsupported. */
  hostConfig?: string;
  socket?: string;
  assumePlatform?: string;
  env?: NodeJS.ProcessEnv;
  spawnTimeoutMs?: number;
  journalMaxBytes?: number;
  journalDenialMaxBytes?: number;
  /** The deadline from accept for a connection to deliver its message (tests lower it). Never applies once the message started. */
  connectionTimeoutMs?: number;
  /** Connections open at once (tests lower it). */
  maxConnections?: number;
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
  hostConfigFile: string | null;
}

/** Resolve and check every location before anything is created. Refuses rather than guesses. */
function planBroker(opts: ServeOptions): BrokerPlan {
  const env = opts.env ?? process.env;
  const host = resolveBrokerHost({ harness: opts.harness, assumePlatform: opts.assumePlatform });
  if (!/^[0-9a-f]{64}$/.test(opts.contractDigest ?? "")) throw new BrokerSetupError("config", "--contract-digest must be the sha256 (64 hex) of the accepted contract every request binds");
  const root = physicalPath(opts.root);
  const journalFile = admissionJournalPath(root);
  if (journalFile === null) throw new BrokerSetupError("config", "not a git repository: the journal lives under the git dir");
  // The git dir is resolved without git and checked to belong to `root`: a rewritten `.git` file must not move the
  // pin, the journal or the object source to another repository (PR #376 review round 2).
  let gitDir: string;
  try {
    gitDir = brokerGitDir(root);
  } catch (err) {
    throw new BrokerSetupError("config", `the git dir of ${root} could not be verified: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (physicalPath(path.dirname(path.dirname(path.dirname(journalFile)))) !== gitDir) {
    throw new BrokerSetupError("config", `git names another git dir for ${root} than ${gitDir}; refusing`);
  }
  const stateDir = brokerStateDir(root, gitDir, env);
  const policyFile = physicalPath(opts.policy ?? path.join(path.dirname(path.dirname(stateDir)), "admission", "policy.json"));
  if (isUnder(policyFile, root)) throw new BrokerSetupError("config", "the policy file is inside the work tree, where the candidate can edit it; keep it outside (default: the state dir)");
  if (!fs.existsSync(policyFile)) throw new BrokerSetupError("config", `no admission policy at ${policyFile} (opengantry.admission-policy.v1); pass --policy <file>`);
  // The same checks run again at every reload (`AdmissionBroker`): a policy that fails them later decides nothing.
  const policyProblem = policyFileProblem(policyFile);
  if (policyProblem !== null) throw new BrokerSetupError("config", policyProblem);
  const socket = physicalPath(opts.socket ?? defaultBrokerSocket(stateDir, env));
  if (!path.isAbsolute(socket)) throw new BrokerSetupError("config", "--socket must be an absolute path");
  for (const [name, dir] of [["work tree", root], ["git dir", gitDir], ["state dir", path.dirname(path.dirname(stateDir))]] as const) {
    if (isUnder(socket, dir)) throw new BrokerSetupError("config", `the socket must not be inside the ${name} (${dir})`);
  }
  if (Buffer.byteLength(socket) > MAX_SOCKET_PATH_BYTES) throw new BrokerSetupError("config", `the socket path is longer than ${MAX_SOCKET_PATH_BYTES} bytes; pass a shorter --socket`);
  const hostConfigFile = opts.hostConfig === undefined ? null : physicalPath(opts.hostConfig);
  if (hostConfigFile !== null && isUnder(hostConfigFile, root)) throw new BrokerSetupError("config", "the host config is inside the work tree, where the candidate can edit it; keep it in the state dir");
  return { root, gitDir, stateDir, socket, policyFile, journalFile, host, contractDigest: opts.contractDigest!, hostConfigFile };
}

/**
 * The host brokers from their configuration file (issue #356, owner decision Q7): the same file checks as the policy, a
 * strict schema, and the credential's own checks (the App key's location and mode) at start, so a misplaced or loose
 * key refuses the broker instead of the first push. `adminDir` is `<state root>/admission`, where the key must live.
 */
export function loadHostBrokers(file: string, adminDir: string): Omit<HostBrokerContext, "gitDir"> {
  const problem = policyFileProblem(file);
  if (problem !== null) throw new BrokerSetupError("config", problem.replace("the policy file", "the host config"));
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new BrokerSetupError("config", `the host config ${file} is not readable JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const parsed = hostConfigSchema.safeParse(value);
  if (!parsed.success) throw new BrokerSetupError("config", `the host config ${file} (opengantry.admission-host.v1): ${formatSchemaIssues(parsed.error)}`);
  const config = parsed.data;
  const c = config.github.credential;
  if (c.kind === "github-actions-oidc") {
    throw new BrokerSetupError("config", "the github-actions-oidc credential is not implemented yet: GitHub does not exchange an Actions OIDC token for an installation token without a separate exchange service; use github-app");
  }
  const credentials = new GitHubAppCredentialProvider({ appId: c.appId, installationId: c.installationId, privateKeyFile: c.privateKeyFile, apiBaseUrl: config.github.apiBaseUrl, repository: config.github.repository, stateRoot: adminDir });
  try {
    credentials.checkKey();
  } catch (err) {
    throw new BrokerSetupError("config", err instanceof HostCredentialError ? err.message : String(err));
  }
  return { config, credentials };
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
function acquireInstanceLock(stateDir: string, info: object | null, gitDir: string): { release: () => void } {
  prepareStateDir(stateDir);
  const repository = acquireLock(path.join(gitDir, "opengantry-admission.lock"), null);
  try {
    const instance = acquireLock(path.join(stateDir, "broker.lock"), info);
    return { release: () => { try { instance.release(); } finally { repository.release(); } } };
  } catch (err) {
    repository.release();
    throw err;
  }
}

function acquireLock(lock: string, info: object | null): { release: () => void } {
  const owner = `${JSON.stringify({ token: crypto.randomUUID(), pid: process.pid })}\n`;
  try {
    fs.writeFileSync(lock, owner, { flag: "wx", mode: 0o600 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    throw new BrokerSetupError("locked", `another admission broker holds ${lock}, or one crashed holding it; delete it (and its socket) only if no broker is running`);
  }
  const infoFile = path.join(path.dirname(lock), "broker.json");
  const release = (): void => {
    if (!fs.existsSync(lock) || fs.readFileSync(lock, "utf8") !== owner) return;
    if (info !== null) fs.rmSync(infoFile, { force: true });
    fs.rmSync(lock);
  };
  try {
    if (info !== null) fs.writeFileSync(infoFile, `${JSON.stringify({ ...info, pid: process.pid, startTime: processStartTime("self"), cmdline: processCmdline("self") })}\n`, { mode: 0o600 });
    return { release };
  } catch (err) {
    release();
    throw err;
  }
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

type ReaderStep = { kind: "more" } | { kind: "line"; line: Buffer } | { kind: "oversized" };

/**
 * Collects one message: everything up to the first newline (`0x0a`), or up to the end of input when there is none.
 * Everything after the first newline is dropped before the size check, in whatever chunks it arrives: the result never
 * depends on how the bytes were split. The line, without its newline, must fit `max`.
 */
export class BrokerMessageReader {
  private chunks: Buffer[] = [];
  private size = 0;

  constructor(private readonly max: number) {}

  push(chunk: Buffer): ReaderStep {
    const nl = chunk.indexOf(0x0a);
    const part = nl === -1 ? chunk : chunk.subarray(0, nl);
    if (this.size + part.length > this.max) {
      this.chunks = [];
      return { kind: "oversized" };
    }
    this.chunks.push(part);
    this.size += part.length;
    return nl === -1 ? { kind: "more" } : { kind: "line", line: this.take() };
  }

  /** The end of input before a newline: what arrived is the message. */
  end(): ReaderStep {
    return { kind: "line", line: this.take() };
  }

  private take(): Buffer {
    const line = Buffer.concat(this.chunks);
    this.chunks = [];
    return line;
  }
}

function parseMessage(line: Buffer): unknown {
  try {
    return JSON.parse(line.toString("utf8"));
  } catch {
    return Symbol.for("not-json");
  }
}

/**
 * Serve one connection: read one message within the bound, answer once, close. Never throws into the server.
 *
 * Before the message starts (its first newline, or the end of input), the connection may be refused: past the deadline
 * from accept (a total deadline, so a client that trickles bytes is cut off too), oversized or malformed, each counted
 * in `summary`. Once it starts, the deadline is off and every further byte is read and dropped: the only answer is the
 * broker's own, however long the dispatch takes. After the answer the connection gets another deadline to go away.
 */
function serveConnection(socket: net.Socket, broker: AdmissionBroker, host: BrokerConfig["host"], summary: AdmissionInputSummary, timeoutMs: number): void {
  const reader = new BrokerMessageReader(BROKER_MAX_MESSAGE_BYTES);
  let answered = false;
  // Set before the broker is called: a message is handled once, whether its newline or the end arrives first.
  let started = false;
  let deadline: NodeJS.Timeout | null = null;
  const clearDeadline = (): void => {
    if (deadline !== null) clearTimeout(deadline);
    deadline = null;
  };
  socket.on("error", () => socket.destroy());
  socket.on("close", clearDeadline);
  /** Answer once; the connection is dropped after the answer is flushed (`close`), or when the client lingers. */
  const answer = (response: BrokerResponse, close = false): void => {
    if (answered) return;
    answered = true;
    clearDeadline();
    deadline = setTimeout(() => socket.destroy(), timeoutMs);
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
  deadline = setTimeout(() => {
    deadline = null;
    if (!started && !answered) refuse("timed_out", malformed("timed out waiting for a complete message", host));
  }, timeoutMs);
  const start = (step: ReaderStep): void => {
    if (answered || started) return;
    if (step.kind === "more") return;
    if (step.kind === "oversized") return refuse("oversized", malformed(`the message exceeds ${BROKER_MAX_MESSAGE_BYTES} bytes`, host));
    started = true;
    clearDeadline();
    const message = parseMessage(step.line);
    if (typeof message === "symbol") return refuse("malformed", malformed("the message is not JSON", host));
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
    start(reader.push(chunk));
  });
  socket.on("end", () => start(reader.end()));
}

/** Over the connection cap: a fixed refusal, counted, and the connection dropped once it is flushed. */
function refuseConnection(socket: net.Socket, summary: AdmissionInputSummary): void {
  summary.note("connection_limit");
  socket.on("error", () => socket.destroy());
  socket.resume();
  const guard = setTimeout(() => socket.destroy(), 1000);
  socket.on("close", () => clearTimeout(guard));
  socket.end(`${JSON.stringify(tooManyConnectionsResponse())}\n`, () => socket.destroy());
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
  const lock = acquireInstanceLock(plan.stateDir, { socket: plan.socket, root: plan.root }, plan.gitDir);
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
      ...(plan.hostConfigFile === null ? {} : { hostBrokers: { ...loadHostBrokers(plan.hostConfigFile, path.dirname(plan.stateDir)), gitDir: plan.gitDir } }),
      ...(opts.spawnTimeoutMs === undefined ? {} : { spawnTimeoutMs: opts.spawnTimeoutMs }),
    });
    const summary = new AdmissionInputSummary(plan.journalFile, opts.summaryWindowMs === undefined ? {} : { windowMs: opts.summaryWindowMs });
    summary.start();
    const timeoutMs = opts.connectionTimeoutMs ?? CONNECTION_TIMEOUT_MS;
    const maxConnections = opts.maxConnections ?? BROKER_MAX_CONNECTIONS;
    let open = 0;
    const srv = net.createServer({ allowHalfOpen: true }, (s) => {
      if (open >= maxConnections) return refuseConnection(s, summary);
      open += 1;
      s.once("close", () => (open -= 1));
      serveConnection(s, broker, plan.host, summary, timeoutMs);
    });
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
      // A dispatch whose client hung up is still running: its effect and outcome record finish before the lock goes.
      await broker.drain();
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

type BrokerRecord = { pid?: unknown; socket?: unknown; startTime?: unknown; cmdline?: unknown };

/** This repository's `broker.json` (under the per-user state dir), or `null` when no broker is recorded. */
function readBrokerRecord(root: string, env: NodeJS.ProcessEnv): BrokerRecord | null {
  const journalFile = admissionJournalPath(physicalPath(root));
  if (journalFile === null) throw new BrokerSetupError("config", "not a git repository");
  const stateDir = brokerStateDir(physicalPath(root), path.dirname(path.dirname(path.dirname(journalFile))), env);
  const file = path.join(stateDir, "broker.json");
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.uid !== process.getuid?.()) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")) as BrokerRecord;
  } catch {
    return null;
  }
}

/** Whether the process that wrote `info` still runs: same pid, start time and full command line (no recycled pid). */
function recordedProcessRuns(info: BrokerRecord): boolean {
  if (!Number.isSafeInteger(info.pid) || (info.pid as number) <= 1) return false;
  const pid = info.pid as number;
  const startTime = processStartTime(pid);
  const cmdline = processCmdline(pid);
  return typeof info.startTime === "string" && startTime === info.startTime && typeof info.cmdline === "string" && cmdline === info.cmdline;
}

/**
 * The relay's check (MSN-0394): `socket` must be the socket this repository's `broker.json` records, and the broker that
 * recorded it must still run. A same-user socket named by an editable environment (an MCP config's `env`) is no broker.
 */
export function recordedBrokerProblem(root: string, socket: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const info = readBrokerRecord(root, env);
  if (info === null) return "no admission broker is recorded for this repository (broker.json)";
  if (typeof info.socket !== "string" || physicalPath(socket) !== info.socket) return `${socket} is not the socket this repository's broker.json records`;
  if (!recordedProcessRuns(info)) return `the broker recorded in broker.json (pid ${String(info.pid)}) is not running`;
  return null;
}

/** `gantry admission stop`: signal the broker named in this repository's `broker.json` (same user only). */
export function stopBroker(root: string, env: NodeJS.ProcessEnv = process.env): { pid: number; socket: string } {
  const info = readBrokerRecord(root, env);
  if (info === null) throw new BrokerSetupError("not_running", "no admission broker is recorded for this repository");
  if (!Number.isSafeInteger(info.pid) || (info.pid as number) <= 1) throw new BrokerSetupError("not_running", "broker.json names no valid pid");
  // A recycled pid must not be signalled: the process must be the very one that wrote broker.json (same start time and
  // the same full command line), not another repository's broker or any other process that got the pid.
  if (!recordedProcessRuns(info) || !(info.cmdline as string).includes("\0admission\0serve\0")) {
    throw new BrokerSetupError("not_running", `the recorded broker (pid ${String(info.pid)}) is not running; remove broker.lock, broker.json and its socket if no broker runs`);
  }
  try {
    process.kill(info.pid as number, "SIGTERM");
  } catch {
    throw new BrokerSetupError("not_running", `the recorded broker (pid ${String(info.pid)}) is not running; remove broker.lock, broker.json and its socket if no broker runs`);
  }
  return { pid: info.pid as number, socket: String(info.socket) };
}

/** The `provenance.observer` of an operator assertion: no broker observed anything, the operator asserted it. */
const OPERATOR_ASSERTION_OBSERVER = "operator-assertion";

/**
 * `gantry admission reconcile --assume-failed <operation>/<attempt>` (PR #376 review round 4): the operator asserts that
 * an `unknown` host attempt failed, where no read can prove it (a ref back at the expected old value may have been
 * reset by another writer after the push landed). Journaled as `reconciled-failed` with
 * `provenance.observer: "operator-assertion"` and the digest of the assertion, never as evidence; a new attempt may then
 * be prepared. The broker's socket has no message for this.
 *
 * It holds the broker's instance lock (in the state dir, which the cage denies) for the whole append, so it refuses
 * while a broker runs and cannot run inside the sandbox. The next broker replays the record at start.
 */
export function assumeAttemptFailed(rootIn: string, attempt: string, env: NodeJS.ProcessEnv = process.env): { operationId: string; attemptId: string; recordDigest: string; assertionDigest: string } {
  const parts = attempt.split("/");
  if (parts.length !== 2 || parts.some((p) => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(p))) throw new BrokerSetupError("config", "--assume-failed takes <operationId>/<attemptId>");
  const [operationId, attemptId] = parts as [string, string];
  const root = physicalPath(rootIn);
  const journalFile = admissionJournalPath(root);
  if (journalFile === null) throw new BrokerSetupError("config", "not a git repository: the journal lives under the git dir");
  let gitDir: string;
  try {
    gitDir = brokerGitDir(root);
  } catch (err) {
    throw new BrokerSetupError("config", `the git dir of ${root} could not be verified: ${err instanceof Error ? err.message : String(err)}`);
  }
  const lock = acquireInstanceLock(brokerStateDir(root, gitDir, env), null, gitDir);
  try {
    let opened: ReturnType<typeof AdmissionJournalFile.open>;
    try {
      opened = AdmissionJournalFile.open(journalFile);
    } catch (err) {
      throw new BrokerSetupError("journal", err instanceof Error ? err.message : String(err));
    }
    const last = opened.records.filter((rec) => rec.receipt.operationId === operationId && rec.receipt.attemptId === attemptId && rec.receipt.receiptKind === "effect").at(-1);
    const prior = last?.receipt;
    if (prior === undefined || prior.receiptKind !== "effect" || prior.state !== "unknown") {
      const state = prior === undefined ? "not dispatched" : prior.receiptKind === "effect" ? prior.state : "decided";
      throw new BrokerSetupError("config", `attempt ${attempt} is ${state}, not unknown; only an unknown attempt can be asserted failed${state === "dispatch-intent" ? " (start the broker once: recovery records it unknown)" : ""}`);
    }
    const assertionDigest = admissionDigest({ assertion: "assume-failed", operationId, attemptId, requestDigest: prior.requestDigest, priorRecordDigest: last!.recordDigest, assertedBy: os.userInfo().username });
    const receipt: AdmissionReceipt = {
      schema: ADMISSION_SCHEMA_IDS.receipt,
      receiptKind: "effect",
      operationId,
      attemptId,
      requestDigest: prior.requestDigest,
      actorIdentity: prior.actorIdentity,
      capabilityId: prior.capabilityId,
      observedLevel: prior.observedLevel,
      state: "reconciled-failed",
      ambiguity: null,
      provenance: { observer: OPERATOR_ASSERTION_OBSERVER, evidenceDigest: assertionDigest },
    };
    let recordDigest: string;
    try {
      recordDigest = opened.journal.append(receipt, { reserve: true }).recordDigest;
    } catch (err) {
      throw new BrokerSetupError("journal", err instanceof Error ? err.message : String(err));
    }
    return { operationId, attemptId, recordDigest, assertionDigest };
  } finally {
    lock.release();
  }
}
