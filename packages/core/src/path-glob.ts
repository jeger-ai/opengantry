/**
 * The one path matcher (ADR-0052 B2 `owner`). Patterns are repository-relative POSIX globs: `*` and `?` stay inside
 * one path segment, `**` spans any depth (a leading `**\/` also matches at the root, a `**` inside a segment spans
 * too); everything else is literal. Backslashes count as `/`, a leading `./` is ignored.
 *
 * Two questions use it:
 * - does a glob match this path exactly (layers, structural rules, trusted automation, cage `glob:` entries);
 * - does a pattern cover this path, i.e. match the path or a folder above it (protected paths, the cage scope,
 *   verify contract paths), so `src/legacy` and `src/legacy/` cover the whole folder.
 */

/** Drops trailing slashes in linear time (a `/\\/+$/` RegExp is quadratic on many slashes). */
function trimTrailingSlashes(p: string): string {
  let end = p.length;
  while (end > 0 && p[end - 1] === "/") end -= 1;
  return p.slice(0, end);
}

function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
}

const compiled = new Map<string, RegExp>();

/** The glob as an anchored RegExp (compiled once per glob). */
export function globToRegExp(glob: string): RegExp {
  const g = normalize(glob);
  const cached = compiled.get(g);
  if (cached) return cached;
  let re = "";
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i]!;
    if (c === "*") {
      if (g[i + 1] === "*") {
        const slashAfter = g[i + 2] === "/";
        re += slashAfter ? "(?:.*/)?" : ".*";
        i += slashAfter ? 2 : 1;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const out = new RegExp(`^${re}$`);
  compiled.set(g, out);
  return out;
}

/** True when the glob matches the whole repository-relative path. */
export function pathMatchesGlobPattern(repoRelPath: string, glob: string): boolean {
  return globToRegExp(glob).test(normalize(repoRelPath));
}

/** True when the pattern matches the path or a folder above it; `.` and an empty pattern cover everything. */
export function patternCoversPath(pattern: string, repoRelPath: string): boolean {
  const g = trimTrailingSlashes(normalize(pattern));
  if (g === "" || g === ".") return true;
  const re = globToRegExp(g);
  const segs = trimTrailingSlashes(normalize(repoRelPath)).split("/");
  for (let i = segs.length; i > 0; i -= 1) {
    if (re.test(segs.slice(0, i).join("/"))) return true;
  }
  return false;
}
