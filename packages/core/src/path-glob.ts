/** Explicit path-glob dialects — callers must declare mode (no silent unify). */

export type PathGlobMode = "perimeter_suffix" | "arch_prefix_tree";

function normalizePath(repoRelPath: string): string {
  return repoRelPath.replace(/\\/g, "/");
}

// Perimeter MANIFEST globs: star-star-slash prefix = suffix match; otherwise exact.
export function pathMatchesGlob(repoRelPath: string, glob: string, mode: PathGlobMode): boolean {
  const norm = normalizePath(repoRelPath);
  const g = normalizePath(glob);

  switch (mode) {
    case "perimeter_suffix":
      if (g.startsWith("**/")) {
        const suffix = g.slice(3);
        return norm.endsWith(suffix) || norm.includes(`/${suffix}`);
      }
      return norm === g;
    case "arch_prefix_tree":
      if (g.endsWith("/**")) {
        const prefix = g.slice(0, -3);
        return norm === prefix || norm.startsWith(`${prefix}/`);
      }
      if (g.endsWith("**")) {
        const prefix = g.slice(0, -2).replace(/\/$/, "");
        return norm === prefix || norm.startsWith(`${prefix}/`);
      }
      return norm === g;
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

/** @deprecated Use pathMatchesGlob with explicit mode — kept for call-site clarity. */
export function pathMatchesPerimeterGlob(repoRelPath: string, glob: string): boolean {
  return pathMatchesGlob(repoRelPath, glob, "perimeter_suffix");
}

/** @deprecated Use pathMatchesGlob with explicit mode — kept for call-site clarity. */
export function pathMatchesArchGlob(repoRelPath: string, glob: string): boolean {
  return pathMatchesGlob(repoRelPath, glob, "arch_prefix_tree");
}
