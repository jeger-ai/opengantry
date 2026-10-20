/**
 * The one path matcher (ADR-0052 B2 `owner`). Globs: `*` and `?` inside one segment, `**` any depth (a leading `**\/`
 * also matches the root); `\` counts as `/`, a leading `./` is ignored. A glob matches whole paths (layers, rules,
 * cage `glob:`); a pattern covers a path when it matches it or a folder above it (protected paths, scopes, contracts).
 */

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
  let g = normalize(pattern);
  while (g.endsWith("/")) g = g.slice(0, -1); // a loop: /\/+$/ is quadratic on many slashes (CodeQL)
  if (g === "" || g === ".") return true;
  const re = globToRegExp(g);
  const p = normalize(repoRelPath);
  if (re.test(p)) return true;
  for (let i = p.indexOf("/"); i !== -1; i = p.indexOf("/", i + 1)) if (re.test(p.slice(0, i))) return true;
  return false;
}
