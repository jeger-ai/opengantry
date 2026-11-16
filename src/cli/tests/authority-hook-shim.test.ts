/**
 * MSN-0381 (issue #356, ADR-0063 Q10): the tracked hook shims run an installed gantry outside the checkout, never the
 * working tree's dist/. The old attack wrote dist/cli/index.js and owned every hook; that file now changes nothing
 * unless a human sets GANTRY_HOOK_LOCAL_BUILD=1. The installed gantry, told so by the shim, refuses a version other than
 * the one the repository pins.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getRepoRoot, gitChildEnv } from "#git/git.js";
import { CLI_VERSION } from "../version.gen.js";

const HOOKS = ["pre-commit", "pre-push", "post-checkout"] as const;
const OG = getRepoRoot();

/** A PATH with node, git and the shell tools, and no gantry from the machine running the tests. */
function toolsPath(): string {
  const tools = fs.mkdtempSync(path.join(os.tmpdir(), "og-hook-tools-"));
  fs.symlinkSync(process.execPath, path.join(tools, "node"));
  const system = ["/usr/local/bin", "/usr/bin", "/bin"].filter((d) => fs.existsSync(d) && !fs.existsSync(path.join(d, "gantry")));
  return [tools, ...system].join(path.delimiter);
}

function repo(): { dest: string; marker: string } {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-hook-shim-"));
  spawnSync("git", ["init", "-q"], { cwd: dest, env: gitChildEnv() });
  fs.mkdirSync(path.join(dest, ".githooks"));
  for (const h of HOOKS) fs.copyFileSync(path.join(OG, ".githooks", h), path.join(dest, ".githooks", h));
  // The candidate's build: proves it ran by writing a marker.
  const marker = path.join(dest, "dist-ran");
  fs.mkdirSync(path.join(dest, "dist", "cli"), { recursive: true });
  fs.writeFileSync(path.join(dest, "dist", "cli", "index.js"), `require("fs").writeFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(" "));\n`);
  return { dest, marker };
}

function stub(dir: string, log: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "gantry"), `#!/bin/sh\nprintf '%s pin=%s\\n' "$*" "$GANTRY_HOOK_REQUIRE_PIN" >> '${log}'\n`, { mode: 0o755 });
}

function runShim(dest: string, hook: string, PATH: string, extra: NodeJS.ProcessEnv = {}): { status: number | null; stderr: string } {
  const env = gitChildEnv({ PATH, ...extra });
  delete env.GANTRY_HOOK_LOCAL_BUILD;
  Object.assign(env, extra);
  const r = spawnSync("bash", [path.join(dest, ".githooks", hook)], { cwd: dest, env, encoding: "utf8", input: "" });
  return { status: r.status, stderr: r.stderr };
}

test("hook shims: the tracked hooks are the templates, byte for byte", () => {
  for (const h of HOOKS) {
    assert.equal(fs.readFileSync(path.join(OG, ".githooks", h), "utf8"), fs.readFileSync(path.join(OG, "templates", ".githooks", h), "utf8"), h);
  }
});

test("hook shims: writing dist/cli/index.js does not change what the hook runs (the old attack)", () => {
  const { dest, marker } = repo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "og-hook-installed-"));
  const log = path.join(outside, "calls.log");
  stub(path.join(outside, "bin"), log);
  for (const h of HOOKS) {
    const r = runShim(dest, h, `${path.join(outside, "bin")}${path.delimiter}${toolsPath()}`);
    assert.equal(r.status, 0, r.stderr);
  }
  assert.equal(fs.existsSync(marker), false, "the working tree's dist/ never ran");
  assert.deepEqual(fs.readFileSync(log, "utf8").trim().split("\n"), HOOKS.map((h) => `hook ${h} pin=1`), "the installed gantry runs, told to check its pin");
});

test("hook shims: a gantry inside the checkout, or linked into it, is skipped; with no other the hook refuses", () => {
  const { dest, marker } = repo();
  const log = path.join(dest, "inner.log");
  stub(path.join(dest, "node_modules", ".bin"), log);
  const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), "og-hook-link-"));
  fs.chmodSync(path.join(dest, "dist", "cli", "index.js"), 0o755);
  fs.symlinkSync(path.join(dest, "dist", "cli", "index.js"), path.join(linkDir, "gantry"));
  const PATH = [linkDir, path.join(dest, "node_modules", ".bin"), "node_modules/.bin", toolsPath()].join(path.delimiter);
  const r = runShim(dest, "pre-commit", PATH);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no installed gantry outside this checkout/);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(fs.existsSync(log), false);
});

test("hook shims: GANTRY_HOOK_LOCAL_BUILD=1 is the explicit opt-in that runs dist/", () => {
  const { dest, marker } = repo();
  const r = runShim(dest, "pre-push", toolsPath(), { GANTRY_HOOK_LOCAL_BUILD: "1" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(marker, "utf8"), "hook pre-push");
});

function pinnedRepo(version: string | null): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-hook-pin-"));
  spawnSync("git", ["init", "-q"], { cwd: dest, env: gitChildEnv() });
  if (version !== null) {
    fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
    fs.writeFileSync(path.join(dest, ".gitagent", "foreman", "SUBSTRATE.version.json"), JSON.stringify({ schema_version: "0.1.0", opengantry_version: version, installed_at: "2026-01-01T00:00:00.000Z", installed_by: "test" }));
  }
  return dest;
}

function hookCli(dest: string, extra: NodeJS.ProcessEnv = {}): { status: number | null; out: string } {
  const env = gitChildEnv(extra);
  if (!("GANTRY_HOOK_REQUIRE_PIN" in extra)) delete env.GANTRY_HOOK_REQUIRE_PIN;
  const r = spawnSync(process.execPath, [path.join(OG, "dist", "cli", "index.js"), "hook", "post-checkout", "0", "0", "0"], { cwd: dest, env, encoding: "utf8" });
  return { status: r.status, out: r.stdout + r.stderr };
}

test("hook pin: run by the shim, the installed gantry refuses a version other than SUBSTRATE.version.json, or no pin", () => {
  const pin = { GANTRY_HOOK_REQUIRE_PIN: "1" };
  const mismatch = hookCli(pinnedRepo("0.0.1"), pin);
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.out, /post-checkout: refused: installed gantry .* is not the version 0\.0\.1 pinned/);
  const missing = hookCli(pinnedRepo(null), pin);
  assert.equal(missing.status, 1);
  assert.match(missing.out, /no gantry version is pinned/);
  assert.equal(hookCli(pinnedRepo(CLI_VERSION), pin).status, 0);
  assert.equal(hookCli(pinnedRepo("0.0.1")).status, 0, "a direct gantry hook call (no shim) is unchanged");
});
