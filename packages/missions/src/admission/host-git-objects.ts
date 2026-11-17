/**
 * What `git.publish` reads from the candidate's repository (issue #356, PR #376 review): its object files, copied, and
 * one remote's URLs, parsed here. Git never runs inside the candidate's repository, so nothing there (config, includes,
 * `commondir`, `objects/info/alternates`, hooks) steers a git the broker starts.
 *
 * - The common dir is pinned from the broker's own git dir (`--absolute-git-dir` at start, physical): the git dir
 *   itself, or, when it holds a `commondir` file, the linked-worktree parent its location implies
 *   (`<common>/worktrees/<name>`). A `commondir` that names anything else is refused.
 * - Objects are copied, never borrowed through alternates (git follows alternates recursively, so a candidate that
 *   writes `objects/info/alternates` could otherwise make the broker push history the sandbox cannot read). Only loose
 *   objects (`objects/xx/<hex>`) and `objects/pack/pack-<hex>.{pack,idx}` are copied; `objects/info/*` (alternates,
 *   http-alternates, commit-graph) is skipped. Every directory is held open (`O_DIRECTORY | O_NOFOLLOW`) and every file
 *   is opened inside the held directory (`/proc/self/fd/<dir>/<name>`, the `openat` equivalent) with `O_NOFOLLOW`; a
 *   symlink or a non-regular file is skipped. The caller then proves the commit's closure is complete in the copy.
 * - The remote's URLs come from `<common>/config` by a minimal parser: no `include`/`includeIf`, no `insteadOf`.
 */
import fs from "node:fs";
import path from "node:path";

const C = fs.constants;
const fdPath = (fd: number, name?: string): string => (name === undefined ? `/proc/self/fd/${fd}` : `/proc/self/fd/${fd}/${name}`);
const errCode = (err: unknown): string => (err as NodeJS.ErrnoException).code ?? String(err);

/** The most object bytes one publish copies; a larger store is refused rather than filling the broker's disk. */
const MAX_OBJECT_COPY_BYTES = 8 * 1024 ** 3;
const MAX_CONFIG_BYTES = 1024 * 1024;
const COPY_CHUNK = 1024 * 1024;

export class CandidateRepoError extends Error {}

function closeQuietly(fd: number | null): void {
  if (fd === null) return;
  try {
    fs.closeSync(fd);
  } catch {
    /* already closed */
  }
}

/** Hold a directory by its physical path: no symlink at the last component, none above it (the held path must match). */
function holdDir(physical: string): number {
  let fd: number | null = null;
  try {
    fd = fs.openSync(physical, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW);
    const held = fs.readlinkSync(fdPath(fd));
    if (held !== physical) throw new CandidateRepoError(`${physical} resolves to ${held}`);
    return fd;
  } catch (err) {
    closeQuietly(fd);
    if (err instanceof CandidateRepoError) throw err;
    throw new CandidateRepoError(`${physical}: ${errCode(err) === "ELOOP" ? "a symlink" : errCode(err)}`);
  }
}

/** A subdirectory of a held directory, not followed if it is a symlink; null if absent or not a real directory. */
function holdSubdir(dirFd: number, name: string): number | null {
  try {
    return fs.openSync(fdPath(dirFd, name), C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW);
  } catch (err) {
    if (["ENOENT", "ELOOP", "ENOTDIR"].includes(errCode(err))) return null;
    throw err;
  }
}

/** A regular file inside a held directory, never through a symlink; null if absent. */
function readSmallFileAt(dirFd: number, name: string, max: number, where: string): string | null {
  let fd: number;
  try {
    fd = fs.openSync(fdPath(dirFd, name), C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK);
  } catch (err) {
    if (errCode(err) === "ENOENT") return null;
    throw new CandidateRepoError(`${where}/${name}: ${errCode(err) === "ELOOP" ? "a symlink" : errCode(err)}`);
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw new CandidateRepoError(`${where}/${name} is not a regular file`);
    if (st.size > max) throw new CandidateRepoError(`${where}/${name} is larger than ${max} bytes`);
    return fs.readFileSync(fd, "utf8");
  } finally {
    closeQuietly(fd);
  }
}

/**
 * The common dir of the broker's git dir. `gitDir` is the physical path the broker resolved at start; the result is
 * `gitDir` itself, or its linked-worktree parent when a `commondir` file names exactly that.
 */
export function pinnedCommonDir(gitDir: string): string {
  const fd = holdDir(gitDir);
  try {
    const content = readSmallFileAt(fd, "commondir", 4096, gitDir);
    if (content === null) return gitDir;
    const named = content.split("\n")[0]!.trim();
    const expected = path.basename(path.dirname(gitDir)) === "worktrees" ? path.dirname(path.dirname(gitDir)) : null;
    let physical: string;
    try {
      physical = fs.realpathSync(path.resolve(gitDir, named));
    } catch {
      throw new CandidateRepoError(`${gitDir}/commondir names ${named}, which does not exist`);
    }
    if (physical !== expected) throw new CandidateRepoError(`${gitDir}/commondir points at ${physical}, not ${expected ?? "nothing (this git dir is not a linked worktree)"}; refusing to read objects from another repository`);
    return expected;
  } finally {
    closeQuietly(fd);
  }
}

/** Copy one regular file from a held directory; false (skipped) for a symlink, a non-regular file or a vanished one. */
function copyFileAt(dirFd: number, name: string, dest: string, budget: { left: number }): boolean {
  let src: number | null = null;
  let out: number | null = null;
  try {
    try {
      src = fs.openSync(fdPath(dirFd, name), C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK);
    } catch (err) {
      if (["ENOENT", "ELOOP"].includes(errCode(err))) return false;
      throw err;
    }
    const st = fs.fstatSync(src);
    if (!st.isFile()) return false;
    if (st.size > budget.left) throw new CandidateRepoError(`the repository's objects exceed ${MAX_OBJECT_COPY_BYTES} bytes; refusing to copy them`);
    budget.left -= st.size;
    out = fs.openSync(dest, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o444);
    const buf = Buffer.alloc(COPY_CHUNK);
    for (let pos = 0; ; ) {
      const n = fs.readSync(src, buf, 0, buf.length, pos);
      if (n === 0) break;
      if (pos + n > st.size) throw new CandidateRepoError(`${name} grew while it was copied`);
      fs.writeSync(out, buf, 0, n);
      pos += n;
    }
    return true;
  } finally {
    closeQuietly(src);
    closeQuietly(out);
  }
}

const LOOSE_DIR = /^[0-9a-f]{2}$/;
const LOOSE_FILE = /^(?:[0-9a-f]{38}|[0-9a-f]{62})$/;
const PACK_FILE = /^pack-(?:[0-9a-f]{40}|[0-9a-f]{64})\.(?:pack|idx)$/;

/** Copy the candidate's loose and packed objects into `destObjects` (a broker-private `objects` dir). */
export function copyObjects(commonDir: string, destObjects: string, maxBytes = MAX_OBJECT_COPY_BYTES): { copied: number; skipped: number } {
  const budget = { left: maxBytes };
  let copied = 0;
  let skipped = 0;
  const top = holdDir(commonDir);
  let objects: number | null = null;
  try {
    objects = holdSubdir(top, "objects");
    if (objects === null) throw new CandidateRepoError(`${commonDir}/objects is missing or not a real directory`);
    for (const name of fs.readdirSync(fdPath(objects))) {
      const files = LOOSE_DIR.test(name) ? LOOSE_FILE : name === "pack" ? PACK_FILE : null;
      if (files === null) continue;
      const sub = holdSubdir(objects, name);
      if (sub === null) {
        skipped += 1;
        continue;
      }
      try {
        const dest = path.join(destObjects, name);
        fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
        for (const f of fs.readdirSync(fdPath(sub))) {
          if (!files.test(f)) continue;
          if (copyFileAt(sub, f, path.join(dest, f), budget)) copied += 1;
          else skipped += 1;
        }
      } finally {
        closeQuietly(sub);
      }
    }
  } finally {
    closeQuietly(objects);
    closeQuietly(top);
  }
  return { copied, skipped };
}

/** A config value: quotes removed, escapes resolved, an unquoted `#`/`;` comment dropped. */
function configValue(raw: string): string {
  let out = "";
  let quoted = false;
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i]!;
    if (c === "\\" && i + 1 < raw.length) {
      const n = raw[++i]!;
      out += n === "n" ? "\n" : n === "t" ? "\t" : n;
    } else if (c === '"') quoted = !quoted;
    else if (!quoted && (c === "#" || c === ";")) break;
    else out += c;
  }
  return out.trim();
}

/** Every `remote.<name>.url` in one config text, without following includes. */
function remoteUrlsIn(configText: string, name: string): string[] {
  const urls: string[] = [];
  let inRemote = false;
  for (const raw of configText.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
    const section = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]/.exec(line);
    if (section) {
      const [, sec, sub] = section;
      inRemote = sub !== undefined ? sec!.toLowerCase() === "remote" && sub.replace(/\\(.)/g, "$1") === name : sec!.toLowerCase() === `remote.${name.toLowerCase()}`;
      continue;
    }
    if (!inRemote) continue;
    const kv = /^([A-Za-z][A-Za-z0-9-]*)\s*(?:=\s*(.*))?$/.exec(line);
    if (kv && kv[1]!.toLowerCase() === "url") urls.push(configValue(kv[2] ?? ""));
  }
  return urls;
}

/** The URLs of remote `name` in the candidate's `<common>/config`, read through a held directory. */
export function candidateRemoteUrls(commonDir: string, name: string): string[] {
  const fd = holdDir(commonDir);
  try {
    const text = readSmallFileAt(fd, "config", MAX_CONFIG_BYTES, commonDir);
    return text === null ? [] : remoteUrlsIn(text, name);
  } finally {
    closeQuietly(fd);
  }
}
