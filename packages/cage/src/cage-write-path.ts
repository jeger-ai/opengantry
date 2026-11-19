import fs from "node:fs";
import path from "node:path";
import { CAGE_HOST_STATE_ENV } from "./cage-host-git.js";

/** Anchor each directory before moving to the next so a live rename cannot redirect an operation. */
export function withCageDirectory<T>(dir: string, create: boolean, action: (pinned: string) => T): T {
  if (process.env[CAGE_HOST_STATE_ENV] === undefined) return action(dir);
  if (process.platform !== "linux" || !path.isAbsolute(dir) || path.normalize(dir) !== dir) {
    throw new Error("cage: expected an absolute Linux directory path");
  }
  const flags = fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW | fs.constants.O_RDONLY;
  let fd = fs.openSync("/", flags);
  try {
    for (const part of dir.split("/").filter(Boolean)) {
      const child = `/proc/self/fd/${String(fd)}/${part}`;
      if (create) {
        try {
          fs.mkdirSync(child);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        }
      }
      const next = fs.openSync(child, flags);
      fs.closeSync(fd);
      fd = next;
    }
    return action(`/proc/self/fd/${String(fd)}`);
  } finally {
    fs.closeSync(fd);
  }
}

export function withCageWriteParent<T>(abs: string, create: boolean, action: (pinned: string) => T): T {
  if (process.env[CAGE_HOST_STATE_ENV] === undefined) return action(abs);
  if (!path.isAbsolute(abs) || path.normalize(abs) !== abs || [".", ".."].includes(path.basename(abs))) {
    throw new Error("cage: expected a normalized absolute path");
  }
  return withCageDirectory(path.dirname(abs), create, (dir) => action(path.join(dir, path.basename(abs))));
}

/** Open a leaf under a pinned parent, and check its type before reading through the descriptor. */
export function withCageReadFile<T>(abs: string, read: (fd: number, stat: fs.Stats) => T): T {
  return withCageWriteParent(abs, false, (pinned) => {
    const flags = process.env[CAGE_HOST_STATE_ENV] === undefined ? fs.constants.O_RDONLY :
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
    const fd = fs.openSync(pinned, flags);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile()) throw new Error("cage: expected a regular file");
      return read(fd, stat);
    } finally {
      fs.closeSync(fd);
    }
  });
}
