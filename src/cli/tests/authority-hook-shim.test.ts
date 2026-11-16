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
import { hookPinVerdict } from "#missions/substrate-version.js";

const HOOKS = ["pre-commit", "pre-push", "post-checkout"] as const;
const OG = getRepoRoot();
/** The version the fixture repositories pin, and the one the stub gantry reports unless told otherwise. */
const PIN = "4.2.0";

function writePin(dest: string, version: string): void {
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.writeFileSync(path.join(dest, ".gitagent", "foreman", "SUBSTRATE.version.json"), `${JSON.stringify({ schema_version: "0.1.0", opengantry_version: version, installed_at: "2026-01-01T00:00:00.000Z", installed_by: "test" }, null, 2)}\n`);
}

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
  writePin(dest, PIN);
  // The candidate's build: proves it ran by writing a marker.
  const marker = path.join(dest, "dist-ran");
  fs.mkdirSync(path.join(dest, "dist", "cli"), { recursive: true });
  fs.writeFileSync(path.join(dest, "dist", "cli", "index.js"), `require("fs").writeFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(" "));\n`);
  return { dest, marker };
}

/** An installed gantry that reports `version` and logs every hook call. */
function stub(dir: string, log: string, version = PIN): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "gantry"), `#!/bin/sh\nif [ "$1" = --version ]; then echo '${version}'; exit 0; fi\nprintf '%s pin=%s\\n' "$*" "$GANTRY_HOOK_REQUIRE_PIN" >> '${log}'\n`, { mode: 0o755 });
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
  assert.match(mismatch.out, /post-checkout: refused: installed gantry .* does not satisfy the version 0\.0\.1 pinned/);
  const missing = hookCli(pinnedRepo(null), pin);
  assert.equal(missing.status, 1);
  assert.match(missing.out, /no gantry version is pinned/);
  assert.equal(hookCli(pinnedRepo(CLI_VERSION), pin).status, 0);
  assert.equal(hookCli(pinnedRepo("0.0.1")).status, 0, "a direct gantry hook call (no shim) is unchanged");
});

test("hook pin: the CLI accepts the same major at or below its version, nothing else", () => {
  const pin = { GANTRY_HOOK_REQUIRE_PIN: "1" };
  const [major, minor, patch] = CLI_VERSION.split("-")[0]!.split(".").map(Number) as [number, number, number];
  assert.equal(hookCli(pinnedRepo(`${String(major)}.0.0`), pin).status, 0, "an older pin of the same major: one install serves both repositories");
  assert.equal(hookCli(pinnedRepo(`${String(major)}.${String(minor)}.${String(patch + 1)}`), pin).status, 1, "a newer pin");
  assert.equal(hookCli(pinnedRepo(`${String(major + 1)}.0.0`), pin).status, 1, "another major");
  assert.equal(hookCli(pinnedRepo("not-a-version"), pin).status, 1, "an unparseable pin");
});

/** [installed, pin, accepted]: one table for the CLI's satisfiesPin and the shims' bash check. */
const PIN_CASES: [string, string, boolean][] = [
  ["4.2.0", "4.2.0", true],
  ["4.2.1", "4.2.0", true],
  ["4.3.0", "4.2.9", true],
  ["4.10.0", "4.9.0", true],
  ["4.2.0", "4.2.0-rc.1", true],
  ["4.2.0-rc.1", "4.2.0-rc.1", true],
  ["4.1.9", "4.2.0", false],
  ["4.2.0", "4.2.1", false],
  ["5.0.0", "4.2.0", false],
  ["3.9.9", "4.2.0", false],
  ["4.2.0-rc.1", "4.2.0", false],
  ["4.2.0-rc.2", "4.2.0-rc.1", false],
  ["v4.2.0", "4.2.0", false],
  ["garbage", "4.2.0", false],
  ["", "4.2.0", false],
  ["4.2.0", "4.2", false],
  // Review round 2: a prerelease passes only when it is exactly the pin, even when it is newer.
  ["4.1.0-rc.1", "4.0.3", false],
  ["4.3.0-rc.1", "4.2.0", false],
  ["4.2.1-rc.1", "4.2.0", false],
  ["4.3.0", "4.2.0-rc.1", true],
];

test("hook pin: the CLI's rule (satisfiesPin), same major and at least the pin", () => {
  for (const [installed, pin, ok] of PIN_CASES) assert.equal(hookPinVerdict(pinnedRepo(pin), installed).ok, ok, `${installed} for pin ${pin}`);
});

test("hook shims: the shim checks the found gantry's version against the pin before it runs it (same table)", () => {
  for (const [installed, pin, ok] of PIN_CASES) {
    const { dest } = repo();
    writePin(dest, pin);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "og-hook-ver-"));
    const log = path.join(outside, "calls.log");
    stub(path.join(outside, "bin"), log, installed);
    const r = runShim(dest, "pre-commit", `${path.join(outside, "bin")}${path.delimiter}${toolsPath()}`);
    assert.equal(r.status, ok ? 0 : 1, `${installed} for pin ${pin}: ${r.stderr}`);
    assert.equal(fs.existsSync(log), ok, `${installed} for pin ${pin}: the gantry ran only when accepted`);
    if (!ok) assert.match(r.stderr, /pre-commit: refused: .* does not satisfy/);
  }
});

test("hook shims: an older gantry that ignores GANTRY_HOOK_REQUIRE_PIN never runs; a missing pin refuses", () => {
  const { dest } = repo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "og-hook-old-"));
  const log = path.join(outside, "calls.log");
  stub(path.join(outside, "bin"), log, "4.0.3");
  const PATH = `${path.join(outside, "bin")}${path.delimiter}${toolsPath()}`;
  const old = runShim(dest, "pre-push", PATH);
  assert.equal(old.status, 1);
  assert.match(old.stderr, /reports version '4\.0\.3', which does not satisfy 4\.2\.0/);
  fs.rmSync(path.join(dest, ".gitagent", "foreman", "SUBSTRATE.version.json"));
  stub(path.join(outside, "bin"), log);
  const missing = runShim(dest, "pre-push", PATH);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /no gantry version is pinned/);
  assert.equal(fs.existsSync(log), false);
});

test("hook shims: a link inside the checkout is skipped before its target is followed", () => {
  const { dest } = repo();
  const binDir = path.join(dest, "node_modules", ".bin");
  fs.mkdirSync(binDir, { recursive: true });
  const truth = ["/usr/bin/true", "/bin/true"].find((p) => fs.existsSync(p))!;
  fs.symlinkSync(truth, path.join(binDir, "gantry"));
  // Also through an outside link whose next hop is a link in the checkout.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "og-hook-hop-"));
  fs.symlinkSync(path.join(binDir, "gantry"), path.join(outside, "gantry"));
  for (const dir of [binDir, outside]) {
    const r = runShim(dest, "pre-commit", `${dir}${path.delimiter}${toolsPath()}`);
    assert.equal(r.status, 1, `${dir}: ${r.stderr}`);
    assert.match(r.stderr, /no installed gantry outside this checkout/);
  }
});

test("hook shims: an npm global install (relative bin link into lib/node_modules) runs", () => {
  const { dest, marker } = repo();
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "og-hook-npm-"));
  const pkgCli = path.join(prefix, "lib", "node_modules", "@jeger-ai", "opengantry", "dist", "cli");
  fs.mkdirSync(pkgCli, { recursive: true });
  const log = path.join(prefix, "calls.log");
  fs.writeFileSync(path.join(pkgCli, "index.js"), `#!/usr/bin/env node\nconst a = process.argv.slice(2);\nif (a[0] === "--version") console.log(${JSON.stringify(PIN)});\nelse require("fs").appendFileSync(${JSON.stringify(log)}, a.join(" ") + " pin=" + process.env.GANTRY_HOOK_REQUIRE_PIN + "\\n");\n`, { mode: 0o755 });
  fs.mkdirSync(path.join(prefix, "bin"));
  fs.symlinkSync("../lib/node_modules/@jeger-ai/opengantry/dist/cli/index.js", path.join(prefix, "bin", "gantry"));
  const r = runShim(dest, "pre-push", `${path.join(prefix, "bin")}${path.delimiter}${toolsPath()}`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(log, "utf8"), "hook pre-push pin=1\n");
  assert.equal(fs.existsSync(marker), false);
});

test("hook shims: the found path runs, not the resolved file, so an argv[0] multiplexer (Volta style) works", () => {
  const { dest } = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "og-hook-volta-"));
  const log = path.join(home, "calls.log");
  fs.writeFileSync(path.join(home, "volta-shim"), `#!/bin/sh\ncase "$(basename "$0")" in\n  gantry) if [ "$1" = --version ]; then echo '${PIN}'; else printf '%s pin=%s\\n' "$*" "$GANTRY_HOOK_REQUIRE_PIN" >> '${log}'; fi ;;\n  *) echo "volta-shim: unknown tool $0" >&2; exit 3 ;;\nesac\n`, { mode: 0o755 });
  fs.mkdirSync(path.join(home, "bin"));
  fs.symlinkSync("../volta-shim", path.join(home, "bin", "gantry"));
  const r = runShim(dest, "post-checkout", `${path.join(home, "bin")}${path.delimiter}${toolsPath()}`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(log, "utf8"), "hook post-checkout pin=1\n");
});

test("pre-push: the checkout's scripts/check-changed-code.sh is not run (the candidate can write it; CI runs it)", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-hook-ccc-"));
  const git = (...args: string[]): string => {
    const r = spawnSync("git", ["-C", dest, ...args], { encoding: "utf8", env: gitChildEnv() });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  fs.writeFileSync(path.join(dest, "README.md"), "x\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  git("checkout", "-qb", "feature");
  const marker = path.join(dest, "ccc-ran");
  fs.mkdirSync(path.join(dest, "scripts"));
  fs.writeFileSync(path.join(dest, "scripts", "check-changed-code.sh"), `#!/bin/sh\ntouch '${marker}'\nexit 0\n`, { mode: 0o755 });
  fs.mkdirSync(path.join(dest, "src", "cli"), { recursive: true });
  fs.writeFileSync(path.join(dest, "src", "cli", "x.ts"), "export const x = 1;\n");
  git("add", "-A");
  git("commit", "-qm", "candidate");
  const head = git("rev-parse", "HEAD");
  const env = gitChildEnv();
  delete env.GANTRY_HOOK_REQUIRE_PIN;
  const r = spawnSync(process.execPath, [path.join(OG, "dist", "cli", "index.js"), "hook", "pre-push", "origin", dest], { cwd: dest, env, encoding: "utf8", input: `refs/heads/feature ${head} refs/heads/feature ${base}\n` });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /nothing to verify/, "the range is checked");
  assert.equal(fs.existsSync(marker), false, "checkout code never runs from the hook");
});

/** A chain of `n` links, all outside the checkout, ending at `target`. Returns the directory holding the first link. */
function linkChain(n: number, target: string): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "og-hook-chain-"));
  let next = target;
  for (let i = n; i >= 1; i--) {
    const d = path.join(base, `l${String(i)}`);
    fs.mkdirSync(d);
    fs.symlinkSync(next, path.join(d, "gantry"));
    next = path.join(d, "gantry");
  }
  return path.join(base, "l1");
}

test("hook shims: a 9-link chain outside the checkout that ends in it is skipped (the final hop is checked; review round 2)", () => {
  const { dest } = repo();
  const evilLog = path.join(dest, "evil.log");
  stub(path.join(dest, "evil"), evilLog);
  const first = linkChain(9, path.join(dest, "evil", "gantry"));
  for (const h of HOOKS) {
    const r = runShim(dest, h, `${first}${path.delimiter}${toolsPath()}`);
    assert.equal(r.status, 1, `${h}: ${r.stderr}`);
    assert.match(r.stderr, /no installed gantry outside this checkout/);
  }
  assert.equal(fs.existsSync(evilLog), false, "the binary in the checkout never ran");
});

test("hook shims: a chain that exhausts the hop limit is skipped, even when it ends outside the checkout", () => {
  const { dest } = repo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "og-hook-long-"));
  const log = path.join(outside, "calls.log");
  stub(path.join(outside, "bin"), log);
  const near = linkChain(15, path.join(outside, "bin", "gantry"));
  assert.equal(runShim(dest, "pre-commit", `${near}${path.delimiter}${toolsPath()}`).status, 0, "15 links and the file fit in 16 hops");
  fs.rmSync(log);
  const far = linkChain(16, path.join(outside, "bin", "gantry"));
  const r = runShim(dest, "pre-commit", `${far}${path.delimiter}${toolsPath()}`);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /no installed gantry outside this checkout/);
  assert.equal(fs.existsSync(log), false);
});
