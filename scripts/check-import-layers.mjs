#!/usr/bin/env node
/**
 * Enforce src/cli import layers for changed TypeScript files.
 * Usage: node scripts/check-import-layers.mjs [file...]
 */
import fs from "node:fs";
import path from "node:path";

const files = process.argv.slice(2).filter((f) => f.endsWith(".ts"));

function fail(msg) {
  console.error(`import-layers: ${msg}`);
  process.exitCode = 1;
}

function layerOf(file) {
  const norm = file.replace(/\\/g, "/");
  if (norm.includes("/src/cli/commands/")) return "command";
  if (norm.includes("/src/cli/lib/")) return "lib";
  if (norm.endsWith("/src/cli/index.ts") || norm.endsWith("/src/cli/program.ts")) return "delivery";
  return "other";
}

function extractImports(source) {
  const imports = [];
  const re = /from\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    imports.push(m[1]);
  }
  return imports;
}

function resolveImportPath(file, spec) {
  if (!spec.startsWith(".")) return null;
  const dir = path.dirname(file);
  let target = path.normalize(path.join(dir, spec));
  if (!target.endsWith(".ts")) target += ".ts";
  return target.replace(/\\/g, "/");
}

for (const file of files) {
  if (!file.includes("src/cli/")) continue;
  const src = fs.readFileSync(file, "utf8");
  const layer = layerOf(file);
  const imports = extractImports(src);

  for (const spec of imports) {
    const resolved = resolveImportPath(file, spec);
    if (!resolved) continue;
    const targetLayer = layerOf(resolved);

    if (layer === "lib" && targetLayer === "command") {
      fail(`${file} must not import command module ${spec}`);
    }
    if (layer === "command" && resolved.includes("runtime-exec-process")) {
      fail(`${file} must not import runtime-exec-process directly; use runtime-exec.js`);
    }
    if (layer === "lib" && spec.includes("commander")) {
      fail(`${file} (lib) must not import commander`);
    }
  }
}

if (process.exitCode !== 1) {
  console.log(`import-layers OK (${files.length} file(s))`);
}
