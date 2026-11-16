import { gunzipSync } from "node:zlib";

/**
 * Read an npm package tarball without unpacking it to disk and without running anything (issue #355 slice 4,
 * ADR-0062 decision 5). Pure: bytes in, a description out. npm (pacote) strips the first path component of every
 * entry, so the package's files are what follows the one top folder; this reader refuses a tarball whose entries do
 * not share one top folder, that names a path with `..` or an absolute path, that repeats `package.json`, that holds
 * a device or fifo entry, or whose header checksum is wrong. Bounded by size and entry count.
 */

export interface TarballLimits {
  maxCompressedBytes: number;
  maxUnpackedBytes: number;
  maxEntries: number;
  maxManifestBytes: number;
}

const TARBALL_LIMITS: TarballLimits = {
  maxCompressedBytes: 128 * 1024 * 1024,
  maxUnpackedBytes: 512 * 1024 * 1024,
  maxEntries: 100_000,
  maxManifestBytes: 4 * 1024 * 1024,
};

export interface TarballContents {
  /** The text of the package's `package.json`. */
  manifest: string;
  /** A `binding.gyp` at the package root: npm then runs `node-gyp rebuild` as an implicit install script. */
  bindingGyp: boolean;
  /** An `npm-shrinkwrap.json` at the package root. */
  shrinkwrap: boolean;
  /** Entries under the package's own `node_modules/`: bundled content the lockfile does not describe. */
  nodeModules: boolean;
  /** Regular files, directories and links counted. */
  entries: number;
}

export type TarballInspection = { ok: true; contents: TarballContents } | { ok: false; detail: string };

class Malformed extends Error {}

const BLOCK = 512;

function cstr(h: Buffer, at: number, len: number): string {
  const end = h.indexOf(0, at);
  return h.toString("utf8", at, end < 0 || end > at + len ? at + len : end);
}

function octal(h: Buffer, at: number, len: number, what: string): number {
  if ((h[at]! & 0x80) !== 0) throw new Malformed(`${what}: base-256 numbers are not accepted`);
  const s = cstr(h, at, len).trim();
  if (!/^[0-7]*$/.test(s)) throw new Malformed(`${what}: not an octal number`);
  const n = s === "" ? 0 : parseInt(s, 8);
  if (!Number.isSafeInteger(n)) throw new Malformed(`${what}: out of range`);
  return n;
}

function checksumOk(h: Buffer): boolean {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i]!;
  return sum === octal(h, 148, 8, "header checksum");
}

/** The `path` record of a pax extended header, or null. */
function paxPath(body: Buffer): string | null {
  let at = 0;
  let found: string | null = null;
  while (at < body.length) {
    const space = body.indexOf(32, at);
    if (space < 0) throw new Malformed("pax header: record without a length");
    const len = Number(body.toString("utf8", at, space));
    if (!Number.isSafeInteger(len) || len <= space - at || at + len > body.length) throw new Malformed("pax header: bad record length");
    const record = body.toString("utf8", space + 1, at + len - 1);
    const eq = record.indexOf("=");
    if (eq > 0 && record.slice(0, eq) === "path") found = record.slice(eq + 1);
    at += len;
  }
  return found;
}

const REGULAR = new Set(["0", "\0", "7"]);
const LINKS = new Set(["1", "2"]);

interface Walk {
  top: string | null;
  manifest: string | null;
  contents: Omit<TarballContents, "manifest">;
}

function visit(w: Walk, full: string, type: string, body: Buffer, limits: TarballLimits): void {
  const name = full.startsWith("./") ? full.slice(2) : full;
  const parts = name.split("/");
  if (name.startsWith("/") || parts.includes("..")) throw new Malformed(`entry ${JSON.stringify(full)} leaves the package folder`);
  const top = parts[0]!;
  if (w.top === null) w.top = top;
  else if (w.top !== top) throw new Malformed(`entries have more than one top folder (${w.top}, ${top})`);
  const rel = parts.slice(1).filter((p) => p !== "" && p !== ".").join("/");
  if (rel === "") {
    if (REGULAR.has(type)) throw new Malformed(`a file ${JSON.stringify(full)} at the top level`);
    return;
  }
  w.contents.entries++;
  if (rel === "node_modules" || rel.startsWith("node_modules/")) w.contents.nodeModules = true;
  if (!REGULAR.has(type)) return;
  if (rel === "package.json") {
    if (w.manifest !== null) throw new Malformed("package.json appears twice");
    if (body.length > limits.maxManifestBytes) throw new Malformed("package.json is too large");
    w.manifest = body.toString("utf8");
  } else if (rel === "binding.gyp") w.contents.bindingGyp = true;
  else if (rel === "npm-shrinkwrap.json") w.contents.shrinkwrap = true;
}

function walk(tar: Buffer, limits: TarballLimits): Walk {
  const w: Walk = { top: null, manifest: null, contents: { bindingGyp: false, shrinkwrap: false, nodeModules: false, entries: 0 } };
  let at = 0;
  let headers = 0;
  let nextPath: string | null = null;
  while (at + BLOCK <= tar.length) {
    const h = tar.subarray(at, at + BLOCK);
    if (h.every((b) => b === 0)) return w;
    if (++headers > limits.maxEntries) throw new Malformed(`more than ${String(limits.maxEntries)} entries`);
    if (!checksumOk(h)) throw new Malformed(`header checksum mismatch at byte ${String(at)}`);
    const size = octal(h, 124, 12, "entry size");
    const type = String.fromCharCode(h[156]!);
    const bodyAt = at + BLOCK;
    if (bodyAt + size > tar.length) throw new Malformed("an entry runs past the end of the archive");
    const body = tar.subarray(bodyAt, bodyAt + size);
    at = bodyAt + Math.ceil(size / BLOCK) * BLOCK;
    if (type === "x") {
      nextPath = paxPath(body);
      continue;
    }
    if (type === "L") {
      nextPath = cstr(body, 0, body.length);
      continue;
    }
    if (type === "g" || type === "K") continue;
    const ustar = h.toString("latin1", 257, 263) === "ustar\0";
    const prefix = ustar ? cstr(h, 345, 155) : "";
    const full = nextPath ?? (prefix ? `${prefix}/${cstr(h, 0, 100)}` : cstr(h, 0, 100));
    nextPath = null;
    if (!REGULAR.has(type) && type !== "5" && !LINKS.has(type)) throw new Malformed(`entry ${JSON.stringify(full)} has unsupported type ${JSON.stringify(type)}`);
    visit(w, full, type, body, limits);
  }
  throw new Malformed("the archive has no end-of-archive marker");
}

/** Describe a gzipped npm package tarball, or say why it cannot be read. */
export function inspectNpmTarball(tgz: Uint8Array, limits: TarballLimits = TARBALL_LIMITS): TarballInspection {
  if (tgz.length > limits.maxCompressedBytes) return { ok: false, detail: `the tarball exceeds ${String(limits.maxCompressedBytes)} bytes` };
  let tar: Buffer;
  try {
    tar = gunzipSync(tgz, { maxOutputLength: limits.maxUnpackedBytes });
  } catch (e) {
    return { ok: false, detail: `not a readable gzip archive within ${String(limits.maxUnpackedBytes)} bytes (${(e as Error).message})` };
  }
  try {
    const w = walk(tar, limits);
    if (w.manifest === null) return { ok: false, detail: "the tarball has no package.json in its top folder" };
    return { ok: true, contents: { manifest: w.manifest, ...w.contents } };
  } catch (e) {
    if (e instanceof Malformed) return { ok: false, detail: e.message };
    throw e;
  }
}
