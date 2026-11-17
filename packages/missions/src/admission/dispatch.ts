/**
 * The broker's first dispatchers (ADR-0063 decision 5, ADM04; issue #356 slice 3), Linux only. Each one has two steps:
 * `check` opens and holds the handles it verified (before the dispatch intent is journaled), and `run` performs the
 * effect through those handles, never through a path string resolved again.
 *
 * Node has no `openat` or `fexecve`. On Linux `/proc/self/fd/<n>` is the held object itself, so
 * - `/proc/self/fd/<dir>/<name>` resolves `<name>` inside the held directory (the `openat` equivalent), and
 * - executing `/proc/self/fd/3` runs the object passed as the child's fd 3. Holding an inode does not freeze its
 *   content, so `process.spawn` runs a broker-private copy: the verified bytes written to a 0500 file in the broker's
 *   own directory, re-hashed through the copy's own fd, executed through that fd and deleted after the process ends.
 *
 * Residual races (documented, not hidden): see `docs/reference/admission-broker.md`.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import { admissionDigest } from "#core/admission.js";
import type { AdmissionRequest } from "#core/schemas/admission-schema.js";

type WriteRequest = Extract<AdmissionRequest, { kind: "workspace.write" }>;
type SpawnRequest = Extract<AdmissionRequest, { kind: "process.spawn" }>;
type FileRef = WriteRequest["resourceIdentity"]["parent"];

/** What a dispatch observed. `unknown` is only for an effect that may or may not have happened. */
export interface DispatchOutcome {
  state: "confirmed" | "failed" | "unknown";
  ambiguity: "crash" | "timeout" | "lost-acknowledgement" | null;
  /** Digest of what was observed (written content, exit status and output); never the raw bytes. */
  evidenceDigest: string | null;
  detail: string;
  result: Record<string, string | number | null>;
}

export type DispatchCheck = { ok: true; run: () => Promise<DispatchOutcome>; release: () => void } | { ok: false; detail: string };

const MAX_CONTENT_BYTES = 768 * 1024;
const MAX_EXECUTABLE_BYTES = 512 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;

/** The raw arguments of each family the broker dispatches; `argsDigest` is the digest of exactly this value. */
export const brokerArgsSchemas = {
  "workspace.write": z.object({ contentBase64: z.string().max(Math.ceil(MAX_CONTENT_BYTES / 3) * 4).regex(/^[A-Za-z0-9+/]*={0,2}$/) }).strict(),
  "process.spawn": z
    .object({
      argv: z.array(z.string().min(1).max(4096).regex(/^[^\0]*$/)).min(1).max(256),
      env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/), z.string().max(8192).regex(/^[^\0]*$/)),
    })
    .strict(),
} as const;
type BrokerArgs<K extends keyof typeof brokerArgsSchemas> = z.infer<(typeof brokerArgsSchemas)[K]>;

/** The environment names a spawned process may receive; nothing is inherited from the broker. */
export const BROKER_SPAWN_ENV_ALLOWLIST: readonly string[] = ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR", "TZ", "USER"];

/** The digest a `process.spawn` request binds as `environmentAllowlistDigest`: the sorted names it passes. */
export const environmentNamesDigest = (env: Record<string, string>): string => admissionDigest(Object.keys(env).sort());

const C = fs.constants;
const errCode = (err: unknown): string => (err as NodeJS.ErrnoException).code ?? String(err);
const fdPath = (fd: number, name?: string): string => (name === undefined ? `/proc/self/fd/${fd}` : `/proc/self/fd/${fd}/${name}`);
const sha256 = (buf: Buffer): string => crypto.createHash("sha256").update(buf).digest("hex");

function closeQuietly(fd: number | null): void {
  if (fd === null) return;
  try {
    fs.closeSync(fd);
  } catch {
    /* already closed */
  }
}

/** The held object is the canonical path the request named, with the identity it named (no symlinked ancestor). */
function heldMatches(fd: number, ref: FileRef): string | null {
  if (ref.identity === null || ref.identity.scheme !== "posix") return "the request names no POSIX file identity";
  const st = fs.fstatSync(fd, { bigint: true });
  if (String(st.dev) !== ref.identity.device || String(st.ino) !== ref.identity.inode) return `${ref.path}: device/inode differ from the request`;
  const actual = fs.readlinkSync(fdPath(fd));
  if (actual !== ref.path) return `${ref.path}: the held object is at ${actual}`;
  return null;
}

/** Open a directory without following a final symlink and check it against the request. */
function holdDirectory(ref: FileRef): { fd: number } | { detail: string } {
  let fd: number | null = null;
  try {
    fd = fs.openSync(ref.path, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW);
    const mismatch = heldMatches(fd, ref);
    if (mismatch !== null) {
      closeQuietly(fd);
      return { detail: mismatch };
    }
    return { fd };
  } catch (err) {
    closeQuietly(fd);
    return { detail: `${ref.path}: ${errCode(err)}` };
  }
}

function lstatIn(dirFd: number, name: string): fs.BigIntStats | null {
  try {
    return fs.lstatSync(fdPath(dirFd, name), { bigint: true });
  } catch (err) {
    if (errCode(err) === "ENOENT") return null;
    throw err;
  }
}

function readHeld(fd: number, max: number): Buffer | null {
  const size = Number(fs.fstatSync(fd).size);
  if (size > max) return null;
  const buf = Buffer.alloc(size);
  let off = 0;
  while (off < size) {
    const n = fs.readSync(fd, buf, off, size - off, off);
    if (n === 0) break;
    off += n;
  }
  return off === size ? buf : null;
}

const failed = (detail: string, result: DispatchOutcome["result"] = {}): DispatchOutcome => ({ state: "failed", ambiguity: null, evidenceDigest: null, detail, result });

/** The syscalls a write dispatch makes after its first mutation; a test seam for failures there. */
export interface WriteIo {
  writeSync: (fd: number, buf: Buffer, offset: number, length: number) => number;
  fsyncSync: (fd: number) => void;
}
const realIo: WriteIo = { writeSync: (fd, buf, off, len) => fs.writeSync(fd, buf, off, len), fsyncSync: (fd) => fs.fsyncSync(fd) };

/** Set once the target may have changed: from then on an error is `unknown`, never `failed` (a retry could duplicate). */
interface Mutation {
  started: boolean;
}

function writeAll(fd: number, content: Buffer, io: WriteIo): void {
  let off = 0;
  while (off < content.length) {
    const n = io.writeSync(fd, content, off, content.length - off);
    if (n <= 0) throw Object.assign(new Error(`short write: ${off} of ${content.length} bytes`), { code: "ESHORTWRITE" });
    off += n;
  }
}

/** Create `<name>` exclusively in the held directory (`priorContentDigest: "absent"`). The `O_CREAT` open is the mutation. */
function createIn(dirFd: number, name: string, content: Buffer, io: WriteIo, m: Mutation): void {
  const fd = fs.openSync(fdPath(dirFd, name), C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o644);
  m.started = true;
  try {
    writeAll(fd, content, io);
    io.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** The target still is the file that was checked: same device and inode, and the same content digest. */
function targetUnchanged(dirFd: number, name: string, expected: { dev: bigint; ino: bigint; digest: string }): boolean {
  let fd: number | null = null;
  try {
    fd = fs.openSync(fdPath(dirFd, name), C.O_RDONLY | C.O_NOFOLLOW);
    const st = fs.fstatSync(fd, { bigint: true });
    if (!st.isFile() || st.dev !== expected.dev || st.ino !== expected.ino) return false;
    const buf = readHeld(fd, MAX_CONTENT_BYTES * 64);
    return buf !== null && sha256(buf) === expected.digest;
  } catch {
    return false;
  } finally {
    closeQuietly(fd);
  }
}

/**
 * Replace `<name>` in the held directory with a new file, renamed over it after the target is re-checked (identity and
 * content digest). The temporary file is not the target: the rename is the mutation.
 */
function replaceIn(dirFd: number, name: string, content: Buffer, expected: { dev: bigint; ino: bigint; digest: string }, io: WriteIo, m: Mutation): void {
  const tmp = `.${name}.og-${crypto.randomBytes(6).toString("hex")}.tmp`;
  const fd = fs.openSync(fdPath(dirFd, tmp), C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o644);
  try {
    try {
      writeAll(fd, content, io);
      io.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (!targetUnchanged(dirFd, name, expected)) throw new Error("the target changed after it was checked");
  } catch (err) {
    fs.rmSync(fdPath(dirFd, tmp), { force: true });
    throw err;
  }
  // rename never follows a symlink at the target name, and both names resolve inside the held directory.
  m.started = true;
  fs.renameSync(fdPath(dirFd, tmp), fdPath(dirFd, name));
}

/**
 * `workspace.write`: hold the parent directory (O_NOFOLLOW, device/inode and path checked), refuse a symlink or a
 * non-regular file in the final component, check the prior content digest (or absence), then write relative to the
 * held directory.
 */
export function checkWorkspaceWrite(request: WriteRequest, args: BrokerArgs<"workspace.write">, io: WriteIo = realIo): DispatchCheck {
  const res = request.resourceIdentity;
  const name = path.posix.basename(res.path);
  if (path.posix.dirname(res.path) !== res.parent.path) return { ok: false, detail: "the parent is not the directory of the path" };
  const content = Buffer.from(args.contentBase64, "base64");
  const dir = holdDirectory(res.parent);
  if ("detail" in dir) return { ok: false, detail: dir.detail };
  const dirFd = dir.fd;
  const refuse = (detail: string): DispatchCheck => {
    closeQuietly(dirFd);
    return { ok: false, detail };
  };
  let prior: { dev: bigint; ino: bigint; digest: string } | null = null;
  try {
    const st = lstatIn(dirFd, name);
    if (st !== null && st.isSymbolicLink()) return refuse(`${res.path} is a symlink`);
    if (st !== null && !st.isFile()) return refuse(`${res.path} is not a regular file`);
    if (res.priorContentDigest === "absent") {
      if (st !== null) return refuse(`${res.path} exists; the request expected it absent`);
    } else {
      if (st === null) return refuse(`${res.path} is absent; the request expected content`);
      const fd = fs.openSync(fdPath(dirFd, name), C.O_RDONLY | C.O_NOFOLLOW);
      try {
        const fst = fs.fstatSync(fd, { bigint: true });
        const buf = readHeld(fd, MAX_CONTENT_BYTES * 64);
        if (buf === null || sha256(buf) !== res.priorContentDigest) return refuse(`${res.path}: the prior content digest differs`);
        prior = { dev: fst.dev, ino: fst.ino, digest: res.priorContentDigest };
      } finally {
        fs.closeSync(fd);
      }
    }
  } catch (err) {
    return refuse(`${res.path}: ${errCode(err)}`);
  }
  const run = async (): Promise<DispatchOutcome> => {
    const mutation: Mutation = { started: false };
    try {
      if (prior === null) createIn(dirFd, name, content, io, mutation);
      else replaceIn(dirFd, name, content, prior, io, mutation);
      io.fsyncSync(dirFd);
    } catch (err) {
      const why = `${res.path}: ${err instanceof Error && !("code" in err) ? err.message : errCode(err)}`;
      // Before the first mutating syscall nothing changed: `failed`, and a new attempt may retry. After it the file may
      // be created, partly written or replaced without being durable: `unknown`, which blocks a retry until reconciled.
      if (!mutation.started) return failed(why);
      return { state: "unknown", ambiguity: "lost-acknowledgement", evidenceDigest: null, detail: `${why} (after the target was mutated)`, result: {} };
    }
    const digest = sha256(content);
    return { state: "confirmed", ambiguity: null, evidenceDigest: digest, detail: `wrote ${content.length} bytes`, result: { contentDigest: digest, bytes: content.length } };
  };
  return { ok: true, run, release: () => closeQuietly(dirFd) };
}

/** The broker's private directory: a real directory, owned by this user, 0700. Anything else refuses. */
function checkPrivateDir(dir: string): string | null {
  try {
    const st = fs.lstatSync(dir);
    if (!st.isDirectory() || st.uid !== process.getuid?.() || (st.mode & 0o077) !== 0) return `the broker's private directory ${dir} must be a directory owned by this user with mode 0700`;
    return null;
  } catch (err) {
    return `the broker's private directory ${dir}: ${errCode(err)}`;
  }
}

/**
 * The verified bytes as a broker-private executable: written to a new 0500 file in a fresh 0700 directory under
 * `privateDir`, under the original file name (a multi-call binary picks its tool from it), reopened read-only and
 * re-hashed through that fd. The returned fd is what runs; nothing outside the broker can rewrite it. `remove` deletes
 * the copy once the process has ended.
 */
function privateCopy(buf: Buffer, digest: string, privateDir: string, name: string): { fd: number; remove: () => void } | { detail: string } {
  const problem = checkPrivateDir(privateDir);
  if (problem !== null) return { detail: problem };
  const dir = path.join(privateDir, crypto.randomBytes(12).toString("hex"));
  const remove = (): void => fs.rmSync(dir, { recursive: true, force: true });
  let fd: number | null = null;
  try {
    fs.mkdirSync(dir, { mode: 0o700 });
    const file = path.join(dir, name);
    const w = fs.openSync(file, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o500);
    try {
      writeAll(w, buf, realIo);
    } finally {
      fs.closeSync(w);
    }
    fd = fs.openSync(file, C.O_RDONLY | C.O_NOFOLLOW);
    const copy = readHeld(fd, MAX_EXECUTABLE_BYTES);
    if (copy === null || sha256(copy) !== digest) throw Object.assign(new Error("digest"), { code: "the copy does not match the verified digest" });
    return { fd, remove };
  } catch (err) {
    closeQuietly(fd);
    remove();
    return { detail: `the broker-private copy of the executable: ${errCode(err)}` };
  }
}

/**
 * Hold the executable (O_NOFOLLOW, regular, executable, identity and path checked), check its content digest, and
 * return a broker-private copy of exactly the bytes that were hashed.
 */
function holdExecutable(res: SpawnRequest["resourceIdentity"], privateDir: string): { fd: number; remove: () => void } | { detail: string } {
  let fd: number | null = null;
  try {
    fd = fs.openSync(res.executable.path, C.O_RDONLY | C.O_NOFOLLOW);
    const st = fs.fstatSync(fd);
    const mismatch = !st.isFile() ? `${res.executable.path} is not a regular file` : (st.mode & 0o111) === 0 ? `${res.executable.path} is not executable` : heldMatches(fd, res.executable);
    const buf = mismatch === null ? readHeld(fd, MAX_EXECUTABLE_BYTES) : null;
    const problem = mismatch ?? (buf === null || sha256(buf) !== res.executableDigest ? `${res.executable.path}: the executable digest differs` : null);
    closeQuietly(fd);
    if (problem !== null) return { detail: problem };
    return privateCopy(buf!, res.executableDigest, privateDir, path.basename(res.executable.path));
  } catch (err) {
    closeQuietly(fd);
    return { detail: `${res.executable.path}: ${errCode(err)}` };
  }
}

function collect(stream: NodeJS.ReadableStream | null, sink: { hash: crypto.Hash; bytes: number }): void {
  stream?.on("data", (chunk: Buffer) => {
    sink.bytes += chunk.length;
    if (sink.bytes <= MAX_OUTPUT_BYTES) sink.hash.update(chunk);
  });
}

/**
 * `process.spawn`: argv array only, never a shell; the environment is exactly the allowlisted names the request bound;
 * a broker-private copy of the verified executable runs as the child's fd 3 and the held cwd is the child's fd 4. Exit (any code) is `confirmed`, a
 * start failure is `failed`, a timeout kills the process group and is `unknown`.
 */
export function checkProcessSpawn(request: SpawnRequest, args: BrokerArgs<"process.spawn">, timeoutMs: number, privateDir: string): DispatchCheck {
  const res = request.resourceIdentity;
  const exe = holdExecutable(res, privateDir);
  if ("detail" in exe) return { ok: false, detail: exe.detail };
  const cwd = holdDirectory(res.cwd);
  if ("detail" in cwd) {
    closeQuietly(exe.fd);
    exe.remove();
    return { ok: false, detail: cwd.detail };
  }
  const release = (): void => {
    closeQuietly(exe.fd);
    closeQuietly(cwd.fd);
    exe.remove();
  };
  const run = (): Promise<DispatchOutcome> =>
    new Promise((resolve) => {
      const out = { hash: crypto.createHash("sha256"), bytes: 0 };
      let settled = false;
      const settle = (o: DispatchOutcome): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(o);
      };
      const child = spawn("/proc/self/fd/3", args.argv.slice(1), {
        argv0: args.argv[0],
        cwd: "/proc/self/fd/4",
        env: { ...args.env },
        shell: false,
        detached: true,
        stdio: ["ignore", "pipe", "pipe", exe.fd, cwd.fd],
      });
      collect(child.stdout, out);
      collect(child.stderr, out);
      const timer = setTimeout(() => {
        try {
          if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
        } catch {
          /* already gone */
        }
        settle({ state: "unknown", ambiguity: "timeout", evidenceDigest: null, detail: `killed after ${timeoutMs} ms`, result: {} });
      }, timeoutMs);
      child.on("error", (err) => settle(failed(`spawn failed: ${errCode(err)}`)));
      child.on("close", (code, signal) => {
        const outputDigest = out.hash.digest("hex");
        const evidence = admissionDigest({ exitCode: code, signal, outputDigest, outputBytes: out.bytes });
        settle({ state: "confirmed", ambiguity: null, evidenceDigest: evidence, detail: `exited ${code ?? signal}`, result: { exitCode: code, signal, outputDigest, outputBytes: out.bytes } });
      });
    });
  return { ok: true, run, release };
}
