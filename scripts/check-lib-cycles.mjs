#!/usr/bin/env node
/**
 * Detect runtime import cycles under src/cli/lib using relative import edges.
 * Ignores `import type` and `export type ... from` (compile-time only).
 * Usage: node scripts/check-lib-cycles.mjs [--json]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const jsonMode = process.argv.includes("--json");
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(scriptDir, "..");
const libRoot = path.join(repoRoot, "src", "cli", "lib");

const distScanner = path.join(repoRoot, "dist", "cli", "lib", "import-scanner.js");
if (!fs.existsSync(distScanner)) {
  console.error("lib-cycles: missing dist/cli/lib/import-scanner.js — run npm run build first");
  process.exit(1);
}

const { extractImportsWithMeta } = await import(pathToFileURL(distScanner).href);

function normalizeRel(file) {
  return file.replace(/\\/g, "/").replace(/^\.\//, "");
}

function resolveImportPath(file, spec) {
  if (!spec.startsWith(".")) return null;
  const dir = path.dirname(file);
  let target = path.normalize(path.join(dir, spec));
  const normalized = target.replace(/\\/g, "/");
  if (normalized.endsWith(".js")) {
    target = normalized.slice(0, -3) + ".ts";
  } else if (!normalized.endsWith(".ts")) {
    target = normalized + ".ts";
  } else {
    target = normalized;
  }
  if (!target.startsWith(libRoot)) return null;
  if (!fs.existsSync(target)) return null;
  return target;
}

function isTypeOnlyImport(snippet) {
  return /^import\s+type\b/.test(snippet.trim());
}

function runtimeExportFromSpecs(source) {
  const specs = [];
  const re = /export\s+(?!type\b)(?:[\w*{}\s,]+)\s+from\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    specs.push(m[1]);
  }
  return specs;
}

function listLibFiles() {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        files.push(abs);
      }
    }
  }
  walk(libRoot);
  return files.sort();
}

function buildAdjacency(files) {
  const fileSet = new Set(files);
  const adj = new Map();
  for (const file of files) {
    adj.set(file, new Set());
  }

  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const imports = extractImportsWithMeta(src, true);
    for (const imp of imports) {
      if (isTypeOnlyImport(imp.snippet)) continue;
      const resolved = resolveImportPath(file, imp.spec);
      if (!resolved || !fileSet.has(resolved)) continue;
      adj.get(file)?.add(resolved);
    }
    for (const spec of runtimeExportFromSpecs(src)) {
      const resolved = resolveImportPath(file, spec);
      if (!resolved || !fileSet.has(resolved)) continue;
      adj.get(file)?.add(resolved);
    }
  }
  return adj;
}

function findCycle(adj) {
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function dfs(node) {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      return stack.slice(start).concat(node);
    }
    if (visited.has(node)) return null;

    visiting.add(node);
    stack.push(node);
    for (const next of adj.get(node) ?? []) {
      const cycle = dfs(next);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  }

  for (const node of adj.keys()) {
    const cycle = dfs(node);
    if (cycle) return cycle;
  }
  return null;
}

const files = listLibFiles();
const adj = buildAdjacency(files);
const cycle = findCycle(adj);

if (cycle) {
  const relCycle = cycle.map((f) => normalizeRel(path.relative(repoRoot, f)));
  const message = `lib-cycles: runtime cycle detected: ${relCycle.join(" -> ")}`;
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify({ schema_version: 1, ok: false, cycle: relCycle })}\n`);
  } else {
    console.error(message);
  }
  process.exit(1);
}

if (jsonMode) {
  process.stdout.write(`${JSON.stringify({ schema_version: 1, ok: true, cycle: null })}\n`);
} else {
  console.log(`lib-cycles OK (${files.length} file(s))`);
}
