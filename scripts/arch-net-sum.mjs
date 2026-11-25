#!/usr/bin/env node
// Net production lines per layer between a base ref and HEAD (issue #400 G2, ADR-0064).
// Usage: node scripts/arch-net-sum.mjs <base-ref>   (after npm run build)
// Both commits are extracted with `git archive` into a temporary directory and counted by ratchetArchBaseline, the
// counter behind `gantry arch check --ratchet`, with HEAD's TARGET_ARCHITECTURE.yaml for both, so the numbers are the
// ones ARCH_BASELINE.json would record. The ratchet writes its baseline into the extract, which is deleted afterwards.
// Exit 0: summed lines did not rise. 1: they rose. 2: missing base ref, missing build, or counting failed.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARCH_MODULE = "dist/packages/missions/src/arch/target-architecture.js";

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function isCommit(ref) {
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function extract(ref, dir) {
  const tar = `${dir}.tar`;
  fs.mkdirSync(dir);
  git(["archive", "--format=tar", "-o", tar, ref]);
  execFileSync("tar", ["-xf", tar, "-C", dir], { stdio: ["ignore", "ignore", "pipe"] });
}

function countTree(arch, spec, treeRoot) {
  return arch.ratchetArchBaseline(spec, treeRoot, arch.walkPerimeterFiles(treeRoot, spec), true).layers;
}

const ZERO = { files: 0, lines: 0, exports: 0 };
const signed = (n) => (n > 0 ? `+${n}` : String(n));
const triple = (c) => `${c.files}/${c.lines}/${c.exports}`;

function report(baseRef, baseSha, headSha, layerIds, base, head) {
  console.log(`arch-net-sum: ${baseRef} (${baseSha.slice(0, 10)}) -> HEAD (${headSha.slice(0, 10)}); files/lines/exports`);
  console.log(`${"layer".padEnd(10)} ${"base".padEnd(18)} ${"head".padEnd(18)} delta`);
  let summed = 0;
  for (const id of layerIds) {
    const b = base[id] ?? ZERO;
    const h = head[id] ?? ZERO;
    summed += h.lines - b.lines;
    const delta = `${signed(h.files - b.files)}/${signed(h.lines - b.lines)}/${signed(h.exports - b.exports)}`;
    console.log(`${id.padEnd(10)} ${triple(b).padEnd(18)} ${triple(h).padEnd(18)} ${delta}`);
  }
  console.log(`summed lines delta: ${signed(summed)}`);
  return summed;
}

async function main(baseRef, tmp) {
  if (!fs.existsSync(path.join(ROOT, ARCH_MODULE))) throw new Error(`${ARCH_MODULE} missing: run npm run build first`);
  const arch = await import("../dist/packages/missions/src/arch/target-architecture.js");
  const baseDir = path.join(tmp, "base");
  const headDir = path.join(tmp, "head");
  extract(baseRef, baseDir);
  extract("HEAD", headDir);
  const spec = arch.loadTargetArchitecture(headDir);
  const baseline = JSON.parse(fs.readFileSync(path.join(headDir, "ARCH_BASELINE.json"), "utf8"));
  const layerIds = Object.keys(baseline.layers ?? {});
  if (layerIds.length === 0) throw new Error("ARCH_BASELINE.json at HEAD lists no layers");
  const base = countTree(arch, spec, baseDir);
  const head = countTree(arch, spec, headDir);
  const summed = report(baseRef, git(["rev-parse", `${baseRef}^{commit}`]), git(["rev-parse", "HEAD"]), layerIds, base, head);
  if (summed > 0) {
    console.error(`arch-net-sum: summed production lines rose by ${summed} against ${baseRef} (G2: net <= 0)`);
    return 1;
  }
  return 0;
}

const baseRef = process.argv[2];
let code = 2;
if (!baseRef) {
  console.error("arch-net-sum: usage: node scripts/arch-net-sum.mjs <base-ref>");
} else if (!isCommit(baseRef)) {
  console.error(`arch-net-sum: base ref ${baseRef} is not a commit here (fetch it first)`);
} else {
  let tmp = null;
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arch-net-sum-"));
    code = await main(baseRef, tmp);
  } catch (e) {
    const detail = e?.stderr?.toString().trim() || (e instanceof Error ? e.message : String(e));
    console.error(`arch-net-sum: cannot count against ${baseRef}: ${detail}`);
    code = 2;
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}
process.exitCode = code;
