#!/usr/bin/env node
/**
 * Remove compiled files from dist/ whose TypeScript source is gone (MSN-0273). Run by `npm run build` right after tsc.
 *
 *   node scripts/prune-dist.mjs [--root <dir>]     # default root: this repository
 *
 * tsc maps src/<path>.ts to dist/<path>.js, .js.map, .d.ts and .d.ts.map but never deletes outputs, so a renamed or
 * deleted source leaves its old module in dist/, where npm test runs stale tests and a hand publish ships stale code.
 * This prunes instead of wiping dist/ first: checkouts are shared by several sessions, and an empty dist/ would break
 * any hook, test run or MCP server using it during the build. Files with a source and files tsc does not emit are
 * never touched. Repo-only (REPO_ONLY_SCRIPTS); not shipped by gantry init.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Longest first, so `x.d.ts.map` is not read as `x.d.ts` + `.map`. */
const OUTPUT_SUFFIXES = [".d.ts.map", ".js.map", ".d.ts", ".js"];

function parseRoot(argv) {
  const i = argv.indexOf("--root");
  if (i === -1) return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const value = argv[i + 1];
  if (!value) {
    console.error("prune-dist: --root needs a directory");
    process.exit(2);
  }
  return path.resolve(value);
}

/** Every regular file under `dir`, depth first; symlinks are left alone. */
function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(abs));
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

/** The source tsc compiled `file` from, or null for a file tsc does not emit. */
function sourceFor(root, file) {
  const rel = path.relative(path.join(root, "dist"), file);
  const suffix = OUTPUT_SUFFIXES.find((s) => rel.endsWith(s));
  if (!suffix) return null;
  return path.join(root, "src", `${rel.slice(0, -suffix.length)}.ts`);
}

/** Removes directories under `dir` (not `dir` itself) that are empty once pruning is done; returns how many. */
function removeEmptyDirs(dir) {
  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const abs = path.join(dir, entry.name);
    removed += removeEmptyDirs(abs);
    if (fs.readdirSync(abs).length === 0) {
      fs.rmdirSync(abs);
      removed += 1;
    }
  }
  return removed;
}

const root = parseRoot(process.argv.slice(2));
const dist = path.join(root, "dist");
if (!fs.existsSync(dist)) {
  console.log("prune-dist: no dist/ to prune");
  process.exit(0);
}

let files = 0;
for (const file of listFiles(dist)) {
  const source = sourceFor(root, file);
  if (source === null || fs.existsSync(source)) continue;
  fs.rmSync(file);
  files += 1;
}
const dirs = removeEmptyDirs(dist);
console.log(`prune-dist: removed ${files} orphaned file(s) and ${dirs} empty director${dirs === 1 ? "y" : "ies"} from dist/`);
