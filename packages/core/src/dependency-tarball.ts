import { gunzipSync } from "node:zlib";

/**
 * Read an npm package tarball without unpacking it to disk and without running anything (issue #355 slice 4,
 * ADR-0062 decision 5). Pure: bytes in, a description out.
 *
 * The reader must never see less than npm extracts: a file npm writes but this reader misses could carry install
 * scripts, a `binding.gyp` or a shrinkwrap past inspection. npm 11 extracts with node-tar (via pacote: `strip: 1`,
 * files only, links and directories skipped). This reader follows node-tar's parser where the result is unambiguous
 * and refuses the archive wherever node-tar could read it differently:
 *
 * - the archive ends at two consecutive zero blocks, as in node-tar; a single zero block, a block that is zero but
 *   for its checksum field, a missing end marker and any non-zero byte after the end marker refuse;
 * - pax `x` headers are honoured as node-tar honours them (`path`, `linkpath`, `size`), with only a small set of
 *   keywords accepted; a pax `size` must equal the ustar size, a pax header must be followed by exactly one entry,
 *   and pax `g`, GNU `L`/`K` and every other meta or unknown type refuse;
 * - every header node-tar would skip as one block while its body is read as headers (bad checksum, no path, a link
 *   without a link target, a link target on a non-link) refuses, and so does a directory with a size, which node-tar
 *   reads as zero;
 * - string and number fields are read as node-tar reads them, and a field node-tar's decoding could read differently
 *   (bytes after the terminating NUL, a checksum without a terminator, base-256) refuses;
 * - paths: no backslash, no empty, `.` or `..` component, no drive-like component, no U+FFFD; after npm's
 *   first-component strip, two entries whose paths match case-insensitively (NFC) refuse, so does a file that is
 *   also a folder, and the root names npm reads (`package.json`, `binding.gyp`, `npm-shrinkwrap.json`,
 *   `node_modules`) are matched case-insensitively;
 * - a non-ASCII pax `path` may be decoded differently by node-tar when it straddles a stream chunk, and node-tar then
 *   falls back to the ustar name; that fallback name is held to the same rules and may not be a name npm reads.
 *
 * Every way node-tar 7.5.22 (`header.js`, `parse.js`, `read-entry.js`, `pax.js`, `large-numbers.js`) throws in
 * `new Header()` or warns and skips in `[CONSUMEHEADER]`, each mapped to gantry's refusal. A skipped header costs one
 * 512-byte block and its body is then read as headers, so each must refuse here:
 *
 * - `Header.decode` throws (caught, `TAR_ENTRY_INVALID`):
 *   - "need 512 bytes for header": the parser only decodes whole blocks; a trailing partial block refuses
 *     ("no end-of-archive marker");
 *   - base-256 `size` (124/12) or checksum (148/12): `octal` refuses any high bit;
 *   - base-256 `mode` 100/8, `uid` 108/8, `gid` 116/8, `mtime` 136/12; with `ustar\0` + `00` magic `devmaj` 329/8 and
 *     `devmin` 337/8; with that magic and byte 475 zero `atime` 476/12 and `ctime` 488/12 (`checkNumericFields`,
 *     before the type is looked at, so `x` headers are covered too);
 *   - a pax `type` keyword assigned through the `type` setter ("invalid entry type"): `type` is not in `PAX_KEYS`;
 *   - GNU `L`/`K` bodies applied as `path`/`linkpath`: those types refuse.
 * - `[CONSUMEHEADER]` warns and skips the block:
 *   - `checksum failure` (including a non-octal or unterminated checksum, which decodes to NaN): `headerKind`;
 *   - `path is required` (empty name, after the prefix and any pax `path`): "a header without a path";
 *   - `linkpath required` on a hard or symbolic link, `linkpath forbidden` on any other non-meta type: `entryPath`.
 * - Not skips, but the body is still mis-framed relative to a naive reader, so refused:
 *   - a single null block followed by more entries (node-tar continues; ends only at two): `checkEnd`;
 *   - a directory with a size (node-tar sets it to 0) and type `0` with a trailing slash (node-tar makes it a
 *     directory): `entryPath`, `visit`;
 *   - a non-octal size (decodes to NaN, read as 0) or a partly numeric one (`parseInt` stops early): `octal`;
 *   - a meta entry above 1 MiB (ignored, not applied) or of size 0 (not applied): refused by size and `parsePax`;
 *   - a pax `size` (overrides the ustar size): must equal it;
 *   - unknown types (body skipped as `ignore`) and pax `g` (applies to every later entry): refused by type.
 * - `new ReadEntry` throws only on an empty path, which is already skipped above; that throw would fail npm anyway.
 *
 * The gzip layer is a single decode (multi-member reads the same in Node's gunzip and npm's minizlib); trailing bytes
 * after the gzip data refuse. Bounded by size and entry count.
 */

/**
 * The node-tar versions this reader has been checked against (ADR-0062, slice 4). npm 11 extracts with the `tar` it
 * bundles; a different node-tar may parse an archive differently, so an npm bundling one not listed here refuses.
 * Adding a version: re-run the differential suite (`packages/core/tests/dependency-install.test.ts`) against an npm
 * that bundles it, and review node-tar's diff of `header.js`, `parse.js`, `pax.js`, `read-entry.js`,
 * `large-numbers.js` and `types.js` against the list below.
 */
const NODE_TAR_VERIFIED: readonly string[] = ["7.5.22"];

/** Null when npm's bundled node-tar is one this reader models; otherwise why not. */
export function nodeTarProblem(version: string | null): string | null {
  if (version === null) return "the npm in use has no readable bundled node-tar (node_modules/tar/package.json)";
  if (NODE_TAR_VERIFIED.includes(version)) return null;
  return `the npm in use bundles node-tar ${version}; gantry's tarball reader is checked against node-tar ${NODE_TAR_VERIFIED.join(", ")} only. No other version is used.`;
}

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
  /** Regular files: npm extracts at most these. */
  files: number;
}

export type TarballInspection = { ok: true; contents: TarballContents } | { ok: false; detail: string };

class Malformed extends Error {}

const BLOCK = 512;
/** node-tar ignores a meta entry above 1 MiB (and then does not apply it). */
const MAX_META_BYTES = 1024 * 1024;
const PAX_KEYS = new Set(["path", "linkpath", "size", "mtime", "atime", "ctime", "uid", "gid", "uname", "gname", "comment"]);
const REGULAR = new Set(["0", "", "7"]);
const LINKS = new Set(["1", "2"]);
const DIRECTORY = "5";

/** A NUL-terminated string field, as node-tar decodes it; bytes after the first NUL must be NUL. */
function str(h: Buffer, at: number, len: number, what: string): string {
  const field = h.subarray(at, at + len);
  const nul = field.indexOf(0);
  if (nul >= 0 && field.subarray(nul).some((b) => b !== 0)) throw new Malformed(`${what}: bytes after the terminating NUL`);
  return field.toString("utf8", 0, nul < 0 ? len : nul);
}

/** An octal number field: optional leading spaces, octal digits, then only NUL or space to the end of the field. */
function octal(h: Buffer, at: number, len: number, what: string, needTerminator = false): number {
  if ((h[at]! & 0x80) !== 0) throw new Malformed(`${what}: base-256 numbers are not accepted`);
  const m = /^ *([0-7]+)([\0 ]*)$/.exec(h.toString("latin1", at, at + len));
  if (!m || (needTerminator && m[2] === "")) throw new Malformed(`${what}: not an octal number`);
  const n = parseInt(m[1]!, 8);
  if (!Number.isSafeInteger(n)) throw new Malformed(`${what}: out of range`);
  return n;
}

/** Zero block, or a header whose checksum holds. node-tar reads the checksum over 12 bytes, so it must end in its 8. */
function headerKind(h: Buffer): "end" | "header" {
  let sum = 0;
  let outside = 0;
  for (let i = 0; i < BLOCK; i++) {
    const inField = i >= 148 && i < 156;
    sum += inField ? 32 : h[i]!;
    if (!inField) outside |= h[i]!;
  }
  if (outside === 0) {
    if (h.subarray(148, 156).every((b) => b === 0)) return "end";
    throw new Malformed("a block that is empty but for its checksum");
  }
  if (sum !== octal(h, 148, 8, "header checksum", true)) throw new Malformed("header checksum mismatch");
  return "header";
}

interface Pax {
  path?: string;
  linkpath?: string;
  size?: number;
  /** The `path` value holds non-ASCII bytes, which node-tar may decode differently. */
  pathNonAscii: boolean;
}

/** Parse a pax `x` body; refuse anything node-tar's line-based parser could read differently. */
function parsePax(body: Buffer): Pax {
  const out: Pax = { pathNonAscii: false };
  const seen = new Set<string>();
  let at = 0;
  if (body.length === 0) throw new Malformed("pax header: empty");
  while (at < body.length) {
    const m = /^([1-9][0-9]{0,6}) /.exec(body.toString("latin1", at, Math.min(body.length, at + 9)));
    if (!m) throw new Malformed("pax header: record without a length");
    const len = Number(m[1]);
    const end = at + len;
    if (end > body.length || body[end - 1] !== 0x0a) throw new Malformed("pax header: bad record length");
    const raw = body.subarray(at + m[0].length, end - 1);
    if (raw.includes(0x0a) || raw.includes(0)) throw new Malformed("pax header: a record holds a newline or NUL");
    const record = raw.toString("utf8");
    const eq = record.indexOf("=");
    const key = eq > 0 ? record.slice(0, eq) : "";
    if (!PAX_KEYS.has(key)) throw new Malformed(`pax header: keyword ${JSON.stringify(key)} is not accepted`);
    if (seen.has(key)) throw new Malformed(`pax header: keyword ${key} repeats`);
    seen.add(key);
    const value = record.slice(eq + 1);
    if (key === "path" || key === "linkpath") {
      if (value === "") throw new Malformed(`pax header: empty ${key}`);
      if (key === "linkpath") out.linkpath = value;
      else {
        out.path = value;
        out.pathNonAscii = raw.some((b) => b >= 0x80);
      }
    } else if (key === "size") {
      if (!/^[0-9]{1,15}$/.test(value)) throw new Malformed("pax header: size is not a decimal number");
      out.size = Number(value);
    }
    at = end;
  }
  return out;
}

interface Walk {
  top: string | null;
  manifest: string | null;
  /** Lower-cased NFC paths (after the first component) of files and links, and of folders (explicit or implied). */
  leaves: Set<string>;
  folders: Set<string>;
  contents: Omit<TarballContents, "manifest">;
}

const fold = (rel: string) => rel.normalize("NFC").toLowerCase();

/** Split and check a path; returns the components after the first one. */
function components(full: string, directory: boolean): { top: string; rel: string[] } {
  if (full.startsWith("/") || full.split(/[/\\]/).includes("..")) throw new Malformed(`entry ${JSON.stringify(full)} leaves the package folder`);
  if (full.includes("\\")) throw new Malformed(`entry ${JSON.stringify(full)} holds a backslash`);
  if (full.includes("�")) throw new Malformed(`entry ${JSON.stringify(full)} is not valid UTF-8`);
  const parts = (directory && full.endsWith("/") ? full.slice(0, -1) : full).split("/");
  for (const p of parts) {
    if (p === "" || p === ".") throw new Malformed(`entry ${JSON.stringify(full)} has an empty or "." path component`);
    if (/^[A-Za-z]:/.test(p)) throw new Malformed(`entry ${JSON.stringify(full)} has a drive-like path component`);
  }
  return { top: parts[0]!, rel: parts.slice(1) };
}

/** A root name npm reads (case-insensitive, as a case-insensitive file system would place it). */
function readByNpm(rel: string[]): boolean {
  const first = fold(rel[0] ?? "");
  return first === "node_modules" || (rel.length === 1 && ["package.json", "binding.gyp", "npm-shrinkwrap.json"].includes(first));
}

/** Record a path in the case-insensitive tree; refuse a duplicate or a file that is also a folder. */
function claim(w: Walk, rel: string[], directory: boolean, full: string): string {
  const key = fold(rel.join("/"));
  for (let i = 1; i < rel.length; i++) {
    const parent = fold(rel.slice(0, i).join("/"));
    if (w.leaves.has(parent)) throw new Malformed(`${JSON.stringify(full)} is inside a file`);
    w.folders.add(parent);
  }
  if (directory) {
    if (w.leaves.has(key)) throw new Malformed(`${JSON.stringify(full)} is both a file and a folder`);
    w.folders.add(key);
  } else {
    if (w.leaves.has(key) || w.folders.has(key)) throw new Malformed(`${JSON.stringify(full)} appears twice (paths are compared without case)`);
    w.leaves.add(key);
  }
  return key;
}

function visit(w: Walk, full: string, type: string, body: Buffer, limits: TarballLimits): void {
  const directory = type === DIRECTORY;
  if (!directory && full.endsWith("/")) throw new Malformed(`entry ${JSON.stringify(full)} names a folder but is not one`);
  const { top, rel } = components(full, directory);
  if (w.top === null) w.top = top;
  else if (w.top !== top) throw new Malformed(`entries have more than one top folder (${w.top}, ${top})`);
  if (rel.length === 0) {
    if (!directory) throw new Malformed(`a file ${JSON.stringify(full)} at the top level`);
    return;
  }
  w.contents.entries++;
  const key = claim(w, rel, directory, full);
  if (fold(rel[0]!) === "node_modules") w.contents.nodeModules = true;
  if (!REGULAR.has(type)) return;
  w.contents.files++;
  if (rel.length !== 1) return;
  if (key === "package.json") {
    if (rel[0] !== "package.json") throw new Malformed(`${JSON.stringify(full)} differs from package.json only in case`);
    if (body.length > limits.maxManifestBytes) throw new Malformed("package.json is too large");
    w.manifest = body.toString("utf8");
  } else if (key === "binding.gyp") w.contents.bindingGyp = true;
  else if (key === "npm-shrinkwrap.json") w.contents.shrinkwrap = true;
}

const isUstar = (h: Buffer) => h.toString("latin1", 257, 265) === "ustar\u000000";

/** The ustar name, joined with the ustar prefix exactly when node-tar joins it. */
function ustarPath(h: Buffer): string {
  const name = str(h, 0, 100, "entry name");
  if (!isUstar(h)) return name;
  const prefix = h[475] !== 0 ? str(h, 345, 155, "entry prefix") : str(h, 345, 130, "entry prefix");
  return prefix ? `${prefix}/${name}` : name;
}

/** The end marker: a second zero block, and only zero bytes after it. */
function checkEnd(tar: Buffer, at: number, pax: Pax | null): void {
  const next = tar.subarray(at + BLOCK, at + 2 * BLOCK);
  if (next.length < BLOCK || next.some((b) => b !== 0)) throw new Malformed(`a single zero block at byte ${String(at)} is not the end of the archive`);
  if (pax !== null) throw new Malformed("a pax header is not followed by an entry");
  if (tar.subarray(at + 2 * BLOCK).some((b) => b !== 0)) throw new Malformed("data after the end-of-archive marker");
}

/** The effective path of a file, folder or link header under an optional pax header, refusing what node-tar skips. */
function entryPath(h: Buffer, type: string, name: string, size: number, pax: Pax | null): string {
  const regular = REGULAR.has(type);
  const link = LINKS.has(type);
  if (!regular && !link && type !== DIRECTORY) throw new Malformed(`entry ${JSON.stringify(name)} has unsupported type ${JSON.stringify(type)}`);
  const linkField = str(h, 157, 100, "link target");
  if (link ? linkField === "" : linkField !== "") throw new Malformed(`entry ${JSON.stringify(name)}: a link target on a non-link, or a link without one`);
  if (pax?.size !== undefined && pax.size !== size) throw new Malformed(`entry ${JSON.stringify(name)}: pax size ${String(pax.size)} disagrees with the header size ${String(size)}`);
  if (!regular && size !== 0) throw new Malformed(`entry ${JSON.stringify(name)}: a folder or link with a size`);
  const full = pax?.path ?? name;
  if (pax?.pathNonAscii) {
    // node-tar may drop a pax path it decodes across a chunk boundary and use the ustar name instead.
    const fallback = components(name, type === DIRECTORY);
    if (fallback.top !== components(full, type === DIRECTORY).top || readByNpm(fallback.rel)) throw new Malformed(`entry ${JSON.stringify(full)}: the ustar name ${JSON.stringify(name)} under a non-ASCII pax path is not harmless`);
  }
  return full;
}

/**
 * The numeric fields node-tar 7.5.22's `Header.decode` reads besides `size` and the checksum, with the condition under
 * which it reads each. A field whose first byte has the high bit set is base-256 there, and `large-numbers.js`
 * `parse` throws unless that byte is 0x80 or 0xff and the value is a safe integer; `[CONSUMEHEADER]` turns the throw
 * into a `TAR_ENTRY_INVALID` warning and reads the body as further headers. gantry refuses the high bit outright.
 * `atime`/`ctime` are read only when byte 475 is zero: otherwise those bytes are the tail of a long ustar prefix.
 */
const NUMERIC_FIELDS: readonly { name: string; at: number; len: number; when: "always" | "ustar" | "ustar-short-prefix" }[] = [
  { name: "mode", at: 100, len: 8, when: "always" },
  { name: "uid", at: 108, len: 8, when: "always" },
  { name: "gid", at: 116, len: 8, when: "always" },
  { name: "mtime", at: 136, len: 12, when: "always" },
  { name: "devmajor", at: 329, len: 8, when: "ustar" },
  { name: "devminor", at: 337, len: 8, when: "ustar" },
  { name: "atime", at: 476, len: 12, when: "ustar-short-prefix" },
  { name: "ctime", at: 488, len: 12, when: "ustar-short-prefix" },
];

/** Refuse every numeric field node-tar would decode as base-256 (and could throw on). Applies to `x` headers too. */
function checkNumericFields(h: Buffer): void {
  const ustar = isUstar(h);
  for (const f of NUMERIC_FIELDS) {
    if (f.when !== "always" && !ustar) continue;
    if (f.when === "ustar-short-prefix" && h[475] !== 0) continue;
    if ((h[f.at]! & 0x80) !== 0) throw new Malformed(`header ${f.name}: base-256 numbers are not accepted`);
  }
}

function walk(tar: Buffer, limits: TarballLimits): Walk {
  const w: Walk = { top: null, manifest: null, leaves: new Set(), folders: new Set(), contents: { bindingGyp: false, shrinkwrap: false, nodeModules: false, entries: 0, files: 0 } };
  let at = 0;
  let headers = 0;
  let pax: Pax | null = null;
  while (at + BLOCK <= tar.length) {
    const h = tar.subarray(at, at + BLOCK);
    if (headerKind(h) === "end") {
      checkEnd(tar, at, pax);
      return w;
    }
    if (++headers > limits.maxEntries) throw new Malformed(`more than ${String(limits.maxEntries)} entries`);
    checkNumericFields(h);
    const type = str(h, 156, 1, "entry type");
    const name = ustarPath(h);
    if (name === "") throw new Malformed(`a header without a path at byte ${String(at)}`);
    const size = octal(h, 124, 12, "entry size");
    const bodyAt = at + BLOCK;
    if (type === "x" && size > MAX_META_BYTES) throw new Malformed("a pax header above 1 MiB");
    if (bodyAt + size > tar.length) throw new Malformed("an entry runs past the end of the archive");
    const body = tar.subarray(bodyAt, bodyAt + size);
    at = bodyAt + Math.ceil(size / BLOCK) * BLOCK;
    if (type === "x") {
      if (pax !== null) throw new Malformed("two pax headers before one entry");
      pax = parsePax(body);
      continue;
    }
    const full = entryPath(h, type, name, size, pax);
    pax = null;
    visit(w, full, type, body, limits);
  }
  throw new Malformed("the archive has no end-of-archive marker");
}

/** Describe a gzipped npm package tarball, or say why it cannot be read. */
export function inspectNpmTarball(tgz: Uint8Array, limits: TarballLimits = TARBALL_LIMITS): TarballInspection {
  if (tgz.length > limits.maxCompressedBytes) return { ok: false, detail: `the tarball exceeds ${String(limits.maxCompressedBytes)} bytes` };
  let tar: Buffer;
  try {
    const out = gunzipSync(tgz, { maxOutputLength: limits.maxUnpackedBytes, info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
    if (out.engine.bytesWritten !== tgz.length) return { ok: false, detail: "bytes after the gzip data" };
    tar = out.buffer;
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
