import fs from "node:fs";
import path from "node:path";
import { normalizeRepoRelativePath } from "#core/posix-path.js";
import type { TsconfigPaths } from "#core/specifier.js";

// The pure classifier lives in core (ADR-0052 step 3b); this module keeps the tsconfig loader and re-exports.

function stripJsonComments(raw: string): string {
  const noBlock = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const noLine = noBlock.replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");
  return noLine.replace(/,(\s*[}\]])/g, "$1");
}

/** Read `compilerOptions.paths` from `<repo>/tsconfig.json` (no `extends` chasing). Null when absent. */
export function loadTsconfigPaths(repoRoot: string, tsconfigRel = "tsconfig.json"): TsconfigPaths | null {
  const abs = path.join(repoRoot, tsconfigRel);
  if (!fs.existsSync(abs)) return null;
  let parsed: { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
  try {
    parsed = JSON.parse(stripJsonComments(fs.readFileSync(abs, "utf8"))) as typeof parsed;
  } catch {
    return null;
  }
  const paths = parsed.compilerOptions?.paths;
  if (!paths || Object.keys(paths).length === 0) return null;
  const tsconfigDir = path.posix.dirname(normalizeRepoRelativePath(tsconfigRel));
  const baseUrl = parsed.compilerOptions?.baseUrl ?? ".";
  const baseDirRel = normalizeRepoRelativePath(path.posix.normalize(path.posix.join(tsconfigDir === "." ? "" : tsconfigDir, baseUrl)));
  return { baseDirRel: baseDirRel === "." ? "" : baseDirRel, paths };
}

