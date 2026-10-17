#!/usr/bin/env node
// ADR-0052 step 1 (MSN-0281): record or check the per-layer architecture baseline.
//   node scripts/arch-baseline.mjs            write ARCH_BASELINE.json from the layers in TARGET_ARCHITECTURE.yaml
//   node scripts/arch-baseline.mjs --check    exit 1 when the file on disk differs from a fresh computation
// Counts per layer: .ts files (tests excluded), their lines, and top-level `export` statements.
// Machine-written (ADR-0047); the only hand edit is none. Replaced by `gantry arch check --ratchet` in step 3.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import YAML from "yaml";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const OUT = path.join(root, "ARCH_BASELINE.json");
const FILE_CEILING_LINES = 800;

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { re += ".*"; i += 1; if (glob[i + 1] === "/") i += 1; }
      else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === "tests" || e.name === "node_modules") continue; out.push(...walk(p)); }
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

function compute() {
  const arch = YAML.parse(fs.readFileSync(path.join(root, "TARGET_ARCHITECTURE.yaml"), "utf8"));
  const files = walk(path.join(root, "src", "cli")).map((f) => path.relative(root, f).split(path.sep).join("/")).sort();
  const layers = {};
  const unmapped = [];
  for (const layer of arch.layers) layers[layer.id] = { files: 0, lines: 0, exports: 0 };
  for (const rel of files) {
    const hits = arch.layers.filter((l) => l.globs.some((g) => globToRegExp(g).test(rel)));
    if (hits.length !== 1) { unmapped.push(`${rel} (${hits.length} layers)`); continue; }
    const body = fs.readFileSync(path.join(root, rel), "utf8");
    const row = layers[hits[0].id];
    row.files += 1;
    row.lines += body.split("\n").length - (body.endsWith("\n") ? 1 : 0);
    row.exports += (body.match(/^export /gm) ?? []).length;
  }
  if (unmapped.length > 0) {
    console.error(`arch-baseline: ${unmapped.length} file(s) not in exactly one layer:\n  ${unmapped.join("\n  ")}`);
    process.exit(2);
  }
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return { schema: "opengantry.arch-baseline.v1", commit, file_ceiling_lines: FILE_CEILING_LINES, layers };
}

const fresh = compute();
if (process.argv.includes("--check")) {
  const onDisk = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const same = JSON.stringify({ ...onDisk, commit: null }) === JSON.stringify({ ...fresh, commit: null });
  console.log(same ? "arch-baseline: OK (counts match ARCH_BASELINE.json)" : "arch-baseline: MISMATCH");
  if (!same) { console.log(JSON.stringify({ on_disk: onDisk.layers, fresh: fresh.layers }, null, 2)); process.exit(1); }
} else {
  fs.writeFileSync(OUT, `${JSON.stringify(fresh, null, 2)}\n`);
  console.log(`arch-baseline: wrote ${path.relative(root, OUT)} at ${fresh.commit.slice(0, 7)}`);
  console.log(JSON.stringify(fresh.layers));
}
