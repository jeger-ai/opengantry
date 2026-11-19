import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CageScopeFile, CageScopeTree } from "./cage-scope.js";

const RAW_OBJECT = /^raw-blob-([a-f0-9]{64})$/;
const RAW_TREE = /^raw-tree-([a-f0-9]{64})$/;
const OPEN_DIR = fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW;
const OPEN_FILE = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
const CHUNK_BYTES = 1024 * 1024;

function digest(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function objectPath(stateDir: string, id: string, pattern: RegExp): string {
  if (!pattern.test(id)) throw new Error("cage: invalid trusted scope object id");
  return path.join(stateDir, "scope-objects", id);
}

function stagingPath(stateDir: string): string {
  const dir = path.join(stateDir, "scope-objects");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return path.join(dir, `.${crypto.randomBytes(8).toString("hex")}.tmp`);
}

function saveObject(stateDir: string, id: string, bytes: Buffer, pattern: RegExp): void {
  const file = objectPath(stateDir, id, pattern);
  if (fs.existsSync(file)) return;
  const temp = stagingPath(stateDir);
  try {
    fs.writeFileSync(temp, bytes, { flag: "wx", mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

function readObject(stateDir: string, id: string, pattern: RegExp): Buffer {
  const bytes = fs.readFileSync(objectPath(stateDir, id, pattern));
  if (!id.endsWith(digest(bytes))) throw new Error("cage: trusted scope object does not match its digest");
  return bytes;
}

function vanished(err: unknown): boolean {
  return ["ENOENT", "ENOTDIR", "ELOOP", "EINVAL"].includes((err as NodeJS.ErrnoException).code ?? "");
}

function withParent<T>(root: string, rel: string, read: (file: string) => T): T | null {
  const parts = rel.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part === ".git")) return null;
  let fd = fs.openSync(root, OPEN_DIR);
  try {
    for (const part of parts.slice(0, -1)) {
      const next = fs.openSync(`/proc/self/fd/${String(fd)}/${part}`, OPEN_DIR);
      fs.closeSync(fd);
      fd = next;
    }
    return read(`/proc/self/fd/${String(fd)}/${parts.at(-1)!}`);
  } catch (err) {
    if (vanished(err)) return null;
    throw err;
  } finally {
    fs.closeSync(fd);
  }
}

function hashFile(fd: number, stage: number | null, chunk: Buffer): { sha256: string; size: number } {
  const hash = crypto.createHash("sha256");
  let size = 0;
  let length: number;
  while ((length = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
    hash.update(chunk.subarray(0, length));
    size += length;
    if (stage === null) continue;
    let offset = 0;
    while (offset < length) offset += fs.writeSync(stage, chunk, offset, length - offset);
  }
  return { sha256: hash.digest("hex"), size };
}

function captureFile(fd: number, stateDir: string, persist: boolean, chunk: Buffer): { sha256: string; size: number } {
  if (!persist) return hashFile(fd, null, chunk);
  const temp = stagingPath(stateDir);
  const stage = fs.openSync(temp, "wx", 0o600);
  try {
    const raw = hashFile(fd, stage, chunk);
    const target = objectPath(stateDir, `raw-blob-${raw.sha256}`, RAW_OBJECT);
    if (!fs.existsSync(target)) fs.renameSync(temp, target);
    return raw;
  } finally {
    fs.closeSync(stage);
    fs.rmSync(temp, { force: true });
  }
}

function readEntry(
  file: string,
  stateDir: string,
  persist: boolean,
  chunk: Buffer,
): Omit<CageScopeFile, "rel"> | null {
  const listed = fs.lstatSync(file);
  if (listed.isSymbolicLink()) {
    const bytes = fs.readlinkSync(file, { encoding: "buffer" });
    const linkTarget = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const oid = `raw-blob-${digest(bytes)}`;
    if (persist) saveObject(stateDir, oid, bytes, RAW_OBJECT);
    const sha256 = digest(Buffer.concat([Buffer.from("symlink\0"), bytes]));
    return { oid, type: "symlink", fileMode: 0o777, raw: { sha256, size: 0, linkTarget } };
  }
  if (!listed.isFile()) return null;
  const fd = fs.openSync(file, OPEN_FILE);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return null;
    const raw = captureFile(fd, stateDir, persist, chunk);
    return { oid: `raw-blob-${raw.sha256}`, type: "file", fileMode: stat.mode & 0o777, raw: { ...raw, linkTarget: null } };
  } finally {
    fs.closeSync(fd);
  }
}

export function captureRawScopeTree(
  root: string,
  stateDir: string,
  paths: Iterable<string>,
  persist: boolean,
): CageScopeTree {
  if (process.platform !== "linux") throw new Error("cage: trusted Git scope requires Linux");
  const files: CageScopeFile[] = [];
  const chunk = Buffer.allocUnsafe(CHUNK_BYTES);
  for (const rel of paths) {
    const entry = withParent(root, rel, (file) => readEntry(file, stateDir, persist, chunk));
    if (entry) files.push({ rel, ...entry });
  }
  const bytes = Buffer.from(JSON.stringify(files));
  const tree = `raw-tree-${digest(bytes)}`;
  if (persist) saveObject(stateDir, tree, bytes, RAW_TREE);
  return { tree, files };
}

export function listRawScopeTree(stateDir: string, tree: string): CageScopeFile[] {
  return JSON.parse(readObject(stateDir, tree, RAW_TREE).toString("utf8")) as CageScopeFile[];
}

export function readRawScopeBlob(stateDir: string, oid: string): Buffer {
  return readObject(stateDir, oid, RAW_OBJECT);
}
