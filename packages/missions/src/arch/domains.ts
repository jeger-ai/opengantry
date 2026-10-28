import fs from "node:fs";
import path from "node:path";

/** `TARGET_ARCHITECTURE.yaml` `domain`: which files the perimeter walks and whether import-layer rules apply. */
const DOMAINS = {
  code: { extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"], importRules: true },
  content: { extensions: [".md", ".html", ".htm", ".txt", ".json"], importRules: false },
} as const;

export type DomainKey = keyof typeof DOMAINS;

export function domainSpec(key: string): (typeof DOMAINS)[DomainKey] {
  const normalized = key.trim().toLowerCase();
  if (!Object.hasOwn(DOMAINS, normalized)) {
    throw new Error(`unknown domain: ${key} (built-in: ${Object.keys(DOMAINS).join(", ")})`);
  }
  return DOMAINS[normalized as DomainKey];
}

const SKIP_DIR_NAMES = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", "out", "vendor"]);

/** Walk repository files with one of `extensions`, skipping dot and build directories. */
export function walkDomainFiles(repoRoot: string, extensions: readonly string[]): string[] {
  const exts = new Set(extensions.map((e) => e.toLowerCase()));
  const files: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (!ent.name.startsWith(".") && !SKIP_DIR_NAMES.has(ent.name)) walk(path.join(dir, ent.name));
      } else if (ent.isFile() && exts.has(path.extname(ent.name).toLowerCase())) {
        files.push(path.join(dir, ent.name));
      }
    }
  };
  walk(repoRoot);
  return files.sort();
}
