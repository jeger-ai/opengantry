// DoD 1 (MSN-0252): package shape — bin, commander-only dependencies, no install scripts, engines, clean install.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { installTarball, npm, packOnce, pkgDir } from "./helpers.mjs";

const HEAVY = ["better-sqlite3", "sqlite-vec", "@modelcontextprotocol/sdk", "ajv", "ajv-formats", "yaml", "zod", "@clack/prompts"];

test("package.json publishes only the gantry-cage bin, with commander as the only dependency (MSN-0258)", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  assert.equal(pkg.name, "@jeger-ai/opengantry-cage");
  assert.deepEqual(pkg.bin, { "gantry-cage": "dist/cli/index.js" });
  assert.deepEqual(Object.keys(pkg.dependencies), ["commander"]);
  assert.equal(pkg.optionalDependencies, undefined);
  assert.equal(pkg.peerDependencies, undefined);
  for (const hook of ["preinstall", "install", "postinstall", "prepare"]) {
    assert.equal(pkg.scripts[hook], undefined, `no ${hook} script`);
  }
  assert.equal(pkg.engines.node, ">=24");
  for (const name of HEAVY) assert.ok(!(name in pkg.dependencies), `${name} must not be a dependency`);
});

test("bundle imports only commander and Node built-ins at runtime", () => {
  const bundle = fs.readFileSync(path.join(pkgDir, "dist", "cli", "lib", "cage", "opengantry-cage.js"), "utf8");
  const bare = new Set();
  // esbuild emits minified ESM: `import{Command as X}from"commander";` (no spaces, not line-anchored).
  for (const m of bundle.matchAll(/\bimport\s*(?:[\w$*{}\s,]+?\s*from\s*)?["']([^"']+)["']/g)) {
    const spec = m[1];
    if (!spec.startsWith("node:") && !spec.startsWith(".")) bare.add(spec);
  }
  assert.deepEqual([...bare].sort(), ["commander"]);
  assert.ok(fs.existsSync(path.join(pkgDir, "dist", "cli", "index.js")), "dist/cli/index.js entry (push guard target)");
});

test("npm pack ships dist + README only; a clean install resolves commander and nothing else", () => {
  const dry = JSON.parse(execFileSync(npm, ["pack", "--dry-run", "--json"], { cwd: pkgDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))[0];
  const files = dry.files.map((f) => f.path).sort();
  assert.deepEqual(files, ["README.md", "dist/cli/index.js", "dist/cli/lib/cage/opengantry-cage.js", "package.json"]);

  const dir = installTarball(packOnce());
  const ls = JSON.parse(execFileSync(npm, ["ls", "--json", "--all"], { cwd: dir, encoding: "utf8" }));
  const names = new Set();
  const walk = (deps) => {
    for (const [name, info] of Object.entries(deps ?? {})) {
      names.add(name);
      walk(info.dependencies);
    }
  };
  walk(ls.dependencies);
  assert.deepEqual([...names].sort(), ["@jeger-ai/opengantry-cage", "commander"]);
  const installed = path.join(dir, "node_modules", "@jeger-ai", "opengantry-cage");
  assert.ok(!fs.existsSync(path.join(installed, "node_modules")), "no nested node_modules");
  for (const name of HEAVY) assert.ok(!fs.existsSync(path.join(dir, "node_modules", name)), `${name} not installed`);
});
