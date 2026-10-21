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

/**
 * Subpath imports from `<repo>/package.json` `imports` as alias paths: `"#core/*": "./dist/packages/core/src/*"`
 * becomes `#core/*` → `packages/core/src/*`, because the build mirrors each package's `src/` under `dist/`.
 * Conditional targets (objects) are skipped. Null when the file or the field is absent.
 */
function loadPackageImportAliases(repoRoot: string): TsconfigPaths | null {
  const abs = path.join(repoRoot, "package.json");
  if (!fs.existsSync(abs)) return null;
  let imports: Record<string, unknown> | undefined;
  try {
    imports = (JSON.parse(fs.readFileSync(abs, "utf8")) as { imports?: Record<string, unknown> }).imports;
  } catch {
    return null;
  }
  const paths: Record<string, string[]> = {};
  for (const [pattern, target] of Object.entries(imports ?? {})) {
    if (typeof target !== "string") continue;
    paths[pattern] = [normalizeRepoRelativePath(target).replace(/^dist\//, "")];
  }
  return Object.keys(paths).length > 0 ? { baseDirRel: "", paths } : null;
}

/** Every alias an import may use: tsconfig `paths` first, then `package.json` subpath imports it does not name. */
export function loadImportAliases(repoRoot: string): TsconfigPaths | null {
  const ts = loadTsconfigPaths(repoRoot);
  const pkg = loadPackageImportAliases(repoRoot);
  if (!ts) return pkg;
  if (!pkg) return ts;
  return { baseDirRel: ts.baseDirRel, paths: { ...pkg.paths, ...ts.paths } };
}
