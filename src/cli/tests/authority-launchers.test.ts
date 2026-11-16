/**
 * MSN-0385 (issue #356, follow-up of MSN-0381): the MCP launcher, the Cursor sessionStart hook and the runtime-env
 * script run an installed gantry outside the checkout that satisfies the pin, never the working tree's dist/, unless a
 * human sets GANTRY_HOOK_LOCAL_BUILD=1. They share the hook shims' resolver block, byte for byte.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getRepoRoot, gitChildEnv } from "#git/git.js";

const OG = getRepoRoot();
const PIN = "4.2.0";

/** Every tracked copy of the resolver block: the hook shims, the launchers, and their templates. */
const RESOLVER_COPIES = [
  ".githooks/pre-commit",
  ".githooks/pre-push",
  ".githooks/post-checkout",
  "templates/.githooks/pre-commit",
  "templates/.githooks/pre-push",
  "templates/.githooks/post-checkout",
  "scripts/mcp-launcher.sh",
  "templates/scripts/mcp-launcher.sh",
  "scripts/gxt-runtime-env.sh",
  "templates/scripts/gxt-runtime-env.sh",
  ".cursor/hooks/gxt-session-start.sh",
  "templates/.cursor/hooks/gxt-session-start.sh",
];

function resolverBlock(rel: string): string {
  const text = fs.readFileSync(path.join(OG, rel), "utf8");
  const start = text.indexOf("# >>> gantry-pinned-resolver");
  const end = text.indexOf("# <<< gantry-pinned-resolver");
  assert.ok(start >= 0 && end > start, `${rel}: resolver block markers`);
  return text.slice(start, end);
}

test("launchers: the resolver block is byte-identical in the hook shims, the launchers and their templates", () => {
  const first = resolverBlock(RESOLVER_COPIES[0]!);
  assert.match(first, /_gxt_pinned_gantry\(\)/);
  for (const rel of RESOLVER_COPIES) assert.equal(resolverBlock(rel), first, rel);
  for (const rel of ["scripts/mcp-launcher.sh", "scripts/gxt-runtime-env.sh", ".cursor/hooks/gxt-session-start.sh"]) {
    assert.equal(fs.readFileSync(path.join(OG, rel), "utf8"), fs.readFileSync(path.join(OG, "templates", rel), "utf8"), `${rel} equals its template`);
  }
});

/** A PATH with node, git and the shell tools, and no gantry from the machine running the tests. */
function toolsPath(): string {
  const tools = fs.mkdtempSync(path.join(os.tmpdir(), "og-launch-tools-"));
  fs.symlinkSync(process.execPath, path.join(tools, "node"));
  const system = ["/usr/local/bin", "/usr/bin", "/bin"].filter((d) => fs.existsSync(d) && !fs.existsSync(path.join(d, "gantry")));
  return [tools, ...system].join(path.delimiter);
}

/** A checkout with the three launchers, a pin, and a candidate-written dist/cli/index.js that leaves a marker. */
function repo(): { dest: string; marker: string } {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-launch-"));
  spawnSync("git", ["init", "-q"], { cwd: dest, env: gitChildEnv() });
  for (const rel of ["scripts/mcp-launcher.sh", "scripts/gxt-runtime-env.sh", ".cursor/hooks/gxt-session-start.sh"]) {
    fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
    fs.copyFileSync(path.join(OG, rel), path.join(dest, rel));
    fs.chmodSync(path.join(dest, rel), 0o755);
  }
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.writeFileSync(path.join(dest, ".gitagent", "foreman", "SUBSTRATE.version.json"), `${JSON.stringify({ schema_version: "0.1.0", opengantry_version: PIN })}\n`);
  const marker = path.join(dest, "dist-ran");
  fs.mkdirSync(path.join(dest, "dist", "cli"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, "dist", "cli", "index.js"),
    `const a = process.argv.slice(2);\nrequire("fs").writeFileSync(${JSON.stringify(marker)}, a.join(" "));\nif (a[0] === "runtime" && a.includes("--json")) process.stdout.write(JSON.stringify({ GANTRY_MSN_ID: "MSN-EVIL" }));\nelse if (a[0] === "runtime") process.stdout.write("export GANTRY_MISSION_FILE=evil\\n");\n`,
  );
  return { dest, marker };
}

/** An installed gantry: answers --version and runtime env, logs every call. */
function stub(dir: string, log: string, version = PIN): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "gantry"),
    `#!/bin/sh\nif [ "$1" = --version ]; then echo '${version}'; exit 0; fi\nprintf '%s\\n' "$*" >> '${log}'\nif [ "$1 $2 $3" = "runtime env --json" ]; then printf '{"GANTRY_MSN_ID":"MSN-0001","GANTRY_SKILL_KEY":"gantry"}'; exit 0; fi\nif [ "$1 $2" = "runtime env" ]; then echo "export GANTRY_MISSION_FILE=installed"; exit 0; fi\nexit 0\n`,
    { mode: 0o755 },
  );
}

function run(dest: string, rel: string, PATH: string, extra: NodeJS.ProcessEnv = {}): { status: number | null; stdout: string; stderr: string } {
  const env = gitChildEnv({ PATH });
  delete env.GANTRY_HOOK_LOCAL_BUILD;
  delete env.CURSOR_PROJECT_DIR;
  delete env.CLAUDE_PROJECT_DIR;
  Object.assign(env, extra);
  const r = spawnSync("bash", [path.join(dest, rel)], { cwd: dest, env, encoding: "utf8", input: "" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const LAUNCHERS = [
  { rel: "scripts/mcp-launcher.sh", call: "mcp serve" },
  { rel: "scripts/gxt-runtime-env.sh", call: "runtime env" },
  { rel: ".cursor/hooks/gxt-session-start.sh", call: "runtime env --json" },
] as const;

test("launchers: writing dist/cli/index.js does not change what they run; the installed gantry runs", () => {
  for (const { rel, call } of LAUNCHERS) {
    const { dest, marker } = repo();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "og-launch-installed-"));
    const log = path.join(outside, "calls.log");
    stub(path.join(outside, "bin"), log);
    const r = run(dest, rel, `${path.join(outside, "bin")}${path.delimiter}${toolsPath()}`);
    assert.equal(r.status, 0, `${rel}: ${r.stderr}`);
    assert.equal(fs.existsSync(marker), false, `${rel}: the working tree's dist/ never ran`);
    assert.equal(fs.readFileSync(log, "utf8").trim(), call, rel);
    if (rel.endsWith("gxt-session-start.sh")) assert.match(r.stdout, /MSN-0001/);
  }
});

test("launchers: with no installed gantry (only one in or linked into the checkout), they refuse and dist/ never runs", () => {
  for (const { rel } of LAUNCHERS) {
    const { dest, marker } = repo();
    const innerLog = path.join(dest, "inner.log");
    stub(path.join(dest, "node_modules", ".bin"), innerLog);
    const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), "og-launch-link-"));
    fs.chmodSync(path.join(dest, "dist", "cli", "index.js"), 0o755);
    fs.symlinkSync(path.join(dest, "dist", "cli", "index.js"), path.join(linkDir, "gantry"));
    const r = run(dest, rel, [linkDir, path.join(dest, "node_modules", ".bin"), "node_modules/.bin", toolsPath()].join(path.delimiter));
    assert.equal(fs.existsSync(marker), false, `${rel}: the working tree's dist/ never ran`);
    assert.equal(fs.existsSync(innerLog), false, `${rel}: the checkout's node_modules/.bin gantry never ran`);
    if (rel.endsWith("gxt-session-start.sh")) {
      assert.equal(r.status, 0, "a sessionStart hook reports, it does not fail the session");
      assert.match(r.stdout, /no installed gantry outside this checkout/);
      assert.doesNotMatch(r.stdout, /MSN-EVIL/);
    } else {
      assert.equal(r.status, 1, `${rel}: ${r.stderr}`);
      assert.match(r.stderr, /no installed gantry outside this checkout/);
    }
  }
});

test("launchers: an installed gantry that does not satisfy the pin never runs", () => {
  for (const { rel } of LAUNCHERS) {
    const { dest, marker } = repo();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "og-launch-old-"));
    const log = path.join(outside, "calls.log");
    stub(path.join(outside, "bin"), log, "4.0.3");
    const r = run(dest, rel, `${path.join(outside, "bin")}${path.delimiter}${toolsPath()}`);
    assert.equal(fs.existsSync(log), false, rel);
    assert.equal(fs.existsSync(marker), false, rel);
    assert.match(r.stdout + r.stderr, /reports version '4\.0\.3', which does not satisfy 4\.2\.0/, rel);
  }
});

test("launchers: GANTRY_HOOK_LOCAL_BUILD=1 is the explicit opt-in that runs dist/", () => {
  for (const { rel, call } of LAUNCHERS) {
    const { dest, marker } = repo();
    const r = run(dest, rel, toolsPath(), { GANTRY_HOOK_LOCAL_BUILD: "1" });
    assert.equal(r.status, 0, `${rel}: ${r.stderr}`);
    assert.equal(fs.readFileSync(marker, "utf8"), call, rel);
  }
});
