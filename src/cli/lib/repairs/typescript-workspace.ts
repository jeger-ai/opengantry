import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

type TsModule = typeof import("typescript");

let cachedTs: TsModule | null | undefined;

function gantryPackageRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..", "..");
}

/** Resolve TypeScript compiler API from adopter workspace or gantry package (lazy, fail-soft). */
export function getWorkspaceTypeScript(root: string): TsModule | null {
  if (cachedTs !== undefined) return cachedTs;
  try {
    const require = createRequire(import.meta.url);
    const searchPaths = [root, gantryPackageRoot()];
    let tsPath: string | undefined;
    for (const base of searchPaths) {
      try {
        tsPath = require.resolve("typescript", { paths: [base] });
        break;
      } catch {
        // try next base
      }
    }
    if (!tsPath) {
      cachedTs = null;
      return null;
    }
    cachedTs = require(tsPath) as TsModule;
  } catch {
    cachedTs = null;
  }
  return cachedTs;
}

/** @internal Reset cache between tests. */
export function clearTypeScriptWorkspaceCache(): void {
  cachedTs = undefined;
}
