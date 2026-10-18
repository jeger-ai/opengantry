import path from "node:path";

/** Repository-relative paths in POSIX form, and back: pure string and path arithmetic, no filesystem. */

/** POSIX repo-relative path (stable across platforms). */
export function toPosixRel(repoRoot: string, absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

/** Convert a POSIX repo-relative path to native separators. */
export function fromPosix(posixPath: string): string {
  return posixPath.split("/").join(path.sep);
}

/** Relative path for user-facing messages (POSIX-normalized). */
export function formatRepoRelative(repoRoot: string, absolutePath: string): string {
  return toPosixRel(repoRoot, absolutePath);
}

/** Absolute path under repo root from a POSIX repo-relative segment. */
export function repoAbsPath(repoRoot: string, posixRel: string): string {
  return path.join(repoRoot, fromPosix(posixRel));
}
