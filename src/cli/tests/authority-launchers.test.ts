/**
 * MSN-0385 (issue #356, follow-up of MSN-0381): the MCP launcher, the Cursor sessionStart hook and the runtime-env
 * script run an installed gantry outside the checkout that satisfies the pin, never the working tree's dist/, unless a
 * human sets GANTRY_MCP_LOCAL_BUILD=1. They share the hook shims' resolver block, byte for byte; each copy passes its
 * own opt-in name in (PR #369 review round), so the variable a Cursor session inherits for the MCP server never switches
 * the git hooks to dist/, and the hooks' GANTRY_HOOK_LOCAL_BUILD never switches the launchers.
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

/** The commands the launchers, the hook shims and the test stubs run by name (the resolver block, git, the stubs). */
const TOOLS = ["bash", "sh", "git", "sed", "head", "readlink", "dirname", "cat"] as const;

/**
 * A PATH of one temporary directory holding links to node and exactly the tools above, so no gantry from the machine
 * running the tests is on it. Whole system directories are not used: on a merged-/usr system the directory that holds
 * an installed gantry also holds bash (PR #369 review round 3). `withNode: false` leaves node out.
 */
function toolsPath({ withNode = true }: { withNode?: boolean } = {}): string {
  const tools = fs.mkdtempSync(path.join(os.tmpdir(), "og-launch-tools-"));
  if (withNode) fs.symlinkSync(process.execPath, path.join(tools, "node"));
  for (const tool of TOOLS) {
    const found = ["/usr/local/bin", "/usr/bin", "/bin"].map((d) => path.join(d, tool)).find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
    assert.ok(found, `${tool} is needed by the launcher tests`);
    fs.symlinkSync(found, path.join(tools, tool));
  }
  return tools;
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
  delete env.GANTRY_MCP_LOCAL_BUILD;
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

test("launchers: GANTRY_MCP_LOCAL_BUILD=1 is the explicit opt-in that runs dist/", () => {
  for (const { rel, call } of LAUNCHERS) {
    const { dest, marker } = repo();
    const r = run(dest, rel, toolsPath(), { GANTRY_MCP_LOCAL_BUILD: "1" });
    assert.equal(r.status, 0, `${rel}: ${r.stderr}`);
    assert.equal(fs.readFileSync(marker, "utf8"), call, rel);
  }
});

test("launchers: the hooks' GANTRY_HOOK_LOCAL_BUILD=1 alone does not make a launcher run dist/", () => {
  for (const { rel } of LAUNCHERS) {
    const { dest, marker } = repo();
    const r = run(dest, rel, toolsPath(), { GANTRY_HOOK_LOCAL_BUILD: "1" });
    assert.equal(fs.existsSync(marker), false, `${rel}: the working tree's dist/ never ran`);
    assert.match(r.stdout + r.stderr, /no installed gantry outside this checkout.*GANTRY_MCP_LOCAL_BUILD=1/, rel);
    if (!rel.endsWith("gxt-session-start.sh")) assert.equal(r.status, 1, rel);
  }
});

test("hook shims: the launchers' GANTRY_MCP_LOCAL_BUILD=1 alone (inherited from a Cursor session) does not make a hook run dist/", () => {
  for (const hook of ["pre-commit", "pre-push", "post-checkout"]) {
    const { dest, marker } = repo();
    const rel = `.githooks/${hook}`;
    fs.mkdirSync(path.join(dest, ".githooks"), { recursive: true });
    fs.copyFileSync(path.join(OG, rel), path.join(dest, rel));
    const r = run(dest, rel, toolsPath(), { GANTRY_MCP_LOCAL_BUILD: "1" });
    assert.equal(r.status, 1, `${hook}: ${r.stderr}`);
    assert.equal(fs.existsSync(marker), false, `${hook}: the working tree's dist/ never ran`);
    assert.match(r.stderr, /no installed gantry outside this checkout.*GANTRY_HOOK_LOCAL_BUILD=1/, hook);
    // Its own opt-in still works.
    const own = run(dest, rel, toolsPath(), { GANTRY_HOOK_LOCAL_BUILD: "1" });
    assert.equal(own.status, 0, `${hook}: ${own.stderr}`);
    assert.ok(fs.readFileSync(marker, "utf8").startsWith(`hook ${hook}`), hook);
  }
});

/** `source scripts/gxt-runtime-env.sh` in a bash that prints its options before and after, then keeps going. */
function sourced(dest: string, PATH: string, callerOpts: string): { status: number | null; stdout: string; stderr: string } {
  const script = `${callerOpts}\nbefore="$-"\nsource scripts/gxt-runtime-env.sh\nrc=$?\necho "still-alive rc=$rc before=$before after=$- mission=\${GANTRY_MISSION_FILE:-}"`;
  const env = gitChildEnv({ PATH });
  delete env.GANTRY_HOOK_LOCAL_BUILD;
  delete env.GANTRY_MCP_LOCAL_BUILD;
  const r = spawnSync("bash", ["-c", script], { cwd: dest, env, encoding: "utf8", input: "" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("runtime-env sourced: a refusal returns 1 and leaves the caller's shell alive with its own options", () => {
  for (const callerOpts of ["", "set -u", "set -o pipefail"]) {
    const { dest, marker } = repo();
    const r = sourced(dest, toolsPath(), callerOpts);
    assert.equal(r.status, 0, `caller ${JSON.stringify(callerOpts)}: ${r.stderr}`);
    const m = /still-alive rc=(\d+) before=(\S*) after=(\S*) mission=(.*)/.exec(r.stdout);
    assert.ok(m, `caller ${JSON.stringify(callerOpts)} survived: ${r.stdout}${r.stderr}`);
    assert.equal(m[1], "1", "the refusal is the source's status");
    assert.equal(m[3], m[2], "the caller's shell options are unchanged");
    assert.match(r.stderr, /no installed gantry outside this checkout/);
    assert.equal(fs.existsSync(marker), false);
  }
});

test("runtime-env sourced: success exports the runtime into the caller and leaves its options unchanged", () => {
  const { dest } = repo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "og-launch-sourced-"));
  stub(path.join(outside, "bin"), path.join(outside, "calls.log"));
  const r = sourced(dest, `${path.join(outside, "bin")}${path.delimiter}${toolsPath()}`, "");
  const m = /still-alive rc=(\d+) before=(\S*) after=(\S*) mission=(.*)/.exec(r.stdout);
  assert.ok(m, r.stdout + r.stderr);
  assert.equal(m[1], "0", r.stderr);
  assert.equal(m[3], m[2], "the caller's shell options are unchanged");
  assert.equal(m[4], "installed", "the runtime is loaded into the caller's shell");
});

test("runtime-env: a shell that is not bash is refused with the reason, before any bash-only code runs", { skip: fs.existsSync("/bin/sh") ? false : "no /bin/sh" }, () => {
  const { dest, marker } = repo();
  const env = gitChildEnv({ PATH: toolsPath() });
  const r = spawnSync("/bin/sh", ["-c", ". scripts/gxt-runtime-env.sh; echo still-alive rc=$?"], { cwd: dest, env, encoding: "utf8" });
  if (/bash/.test(fs.realpathSync("/bin/sh"))) return; // /bin/sh is bash here: nothing to refuse
  assert.match(r.stdout, /still-alive rc=1/, r.stdout + r.stderr);
  assert.match(r.stderr, /requires bash/);
  assert.equal(fs.existsSync(marker), false);
});

/** A hook shim copied into the fixture checkout, ready to run. */
function withShim(dest: string, hook: string): string {
  const rel = `.githooks/${hook}`;
  fs.mkdirSync(path.join(dest, ".githooks"), { recursive: true });
  fs.copyFileSync(path.join(OG, rel), path.join(dest, rel));
  return rel;
}

/** Every launcher, and the pre-commit hook shim: the callers of the shared resolver block. */
const CALLERS = [...LAUNCHERS.map((l) => l.rel), ".githooks/pre-commit"] as const;

function prepare(dest: string, rel: string): void {
  if (rel.startsWith(".githooks/")) withShim(dest, path.basename(rel));
}

function refused(rel: string, r: { status: number | null; stdout: string; stderr: string }, why: RegExp): void {
  assert.match(r.stdout + r.stderr, why, `${rel}: ${r.stdout}${r.stderr}`);
  assert.equal(r.status, rel.endsWith("gxt-session-start.sh") ? 0 : 1, rel);
}

test("PR #369 round 3: a PATH directory reached through a link in the checkout is inside, wherever the link points", () => {
  for (const rel of CALLERS) {
    for (const layout of ["toolbin", "node_modules/.bin", "vendor/bin"] as const) {
      const { dest, marker } = repo();
      prepare(dest, rel);
      // The agent's gantry, outside the checkout, reporting the pin: only a link inside the checkout leads to it.
      const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "og-launch-elsewhere-"));
      const log = path.join(elsewhere, "calls.log");
      stub(path.join(elsewhere, "bin"), log);
      const linked = layout === "vendor/bin" ? path.join(dest, "vendor") : path.join(dest, layout);
      fs.mkdirSync(path.dirname(linked), { recursive: true });
      fs.symlinkSync(layout === "vendor/bin" ? elsewhere : path.join(elsewhere, "bin"), linked);
      const r = run(dest, rel, [path.join(dest, layout), toolsPath()].join(path.delimiter));
      assert.equal(fs.existsSync(log), false, `${rel} ${layout}: the gantry behind the checkout's link never ran`);
      assert.equal(fs.existsSync(marker), false, rel);
      refused(rel, r, /no installed gantry outside this checkout/);
    }
  }
});

test("PR #369 round 3: a link hop through a directory link in the checkout is inside, although it resolves outside", () => {
  for (const rel of CALLERS) {
    const { dest, marker } = repo();
    prepare(dest, rel);
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "og-launch-hop-"));
    const log = path.join(elsewhere, "calls.log");
    stub(path.join(elsewhere, "bin"), log);
    fs.symlinkSync(path.join(elsewhere, "bin"), path.join(dest, "linkdir"));
    // An outside PATH entry whose gantry links to $top/linkdir/gantry: the hop's own path is in the checkout.
    const entry = fs.mkdtempSync(path.join(os.tmpdir(), "og-launch-entry-"));
    fs.symlinkSync(path.join(dest, "linkdir", "gantry"), path.join(entry, "gantry"));
    const r = run(dest, rel, [entry, toolsPath()].join(path.delimiter));
    assert.equal(fs.existsSync(log), false, `${rel}: the gantry reached through the checkout's link never ran`);
    assert.equal(fs.existsSync(marker), false, rel);
    refused(rel, r, /no installed gantry outside this checkout/);
  }
});

/** An installed gantry as npm installs it: `#!/usr/bin/env node`, so the node it runs on is looked up through PATH. */
function nodeStub(dir: string, log: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "gantry"),
    `#!/usr/bin/env node\nconst a = process.argv.slice(2);\nif (a[0] === "--version") { console.log(${JSON.stringify(PIN)}); process.exit(0); }\nrequire("fs").appendFileSync(${JSON.stringify(log)}, a.join(" ") + "\\n");\nif (a.join(" ") === "runtime env --json") process.stdout.write(JSON.stringify({ GANTRY_MSN_ID: "MSN-0001" }));\nelse if (a[0] === "runtime") process.stdout.write("export GANTRY_MISSION_FILE=installed\\n");\n`,
    { mode: 0o755 },
  );
}

/** A node and a git the agent plants in the checkout: they leave a marker, then do the real thing. */
function plant(dir: string, planted: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const git = ["/usr/local/bin/git", "/usr/bin/git", "/bin/git"].find((f) => fs.existsSync(f))!;
  fs.writeFileSync(path.join(dir, "node"), `#!/bin/sh\necho "node $*" >> '${planted}'\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, "git"), `#!/bin/sh\necho "git $*" >> '${planted}'\nexec '${git}' "$@"\n`, { mode: 0o755 });
}

test("PR #369 round 3: a node or git planted in the checkout never runs, under npm run's PATH or a checkout bin directory", () => {
  for (const rel of CALLERS) {
    for (const layout of ["node_modules/.bin", "bin"] as const) {
      const { dest, marker } = repo();
      prepare(dest, rel);
      const planted = path.join(os.tmpdir(), `og-planted-${path.basename(dest)}`);
      plant(path.join(dest, layout), planted);
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "og-launch-envnode-"));
      const log = path.join(outside, "calls.log");
      nodeStub(path.join(outside, "bin"), log);
      // npm run puts <checkout>/node_modules/.bin first; profiles add relative entries.
      const PATH = [path.join(dest, layout), layout, path.join(outside, "bin"), toolsPath()].join(path.delimiter);
      const r = run(dest, rel, PATH);
      assert.equal(fs.existsSync(planted), false, `${rel} ${layout}: the planted tool ran: ${fs.existsSync(planted) ? fs.readFileSync(planted, "utf8") : ""}`);
      assert.equal(fs.existsSync(marker), false, rel);
      assert.equal(r.status, 0, `${rel} ${layout}: ${r.stderr}`);
      assert.ok(fs.readFileSync(log, "utf8").length > 0, `${rel}: the installed gantry ran on the system node`);
    }
  }
});

test("PR #369 round 3: with no node outside the checkout, the resolver refuses instead of running the checkout's node", () => {
  for (const rel of CALLERS) {
    const { dest, marker } = repo();
    prepare(dest, rel);
    const planted = path.join(os.tmpdir(), `og-planted-${path.basename(dest)}`);
    plant(path.join(dest, "node_modules", ".bin"), planted);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "og-launch-nonode-"));
    const log = path.join(outside, "calls.log");
    nodeStub(path.join(outside, "bin"), log);
    const r = run(dest, rel, [path.join(dest, "node_modules", ".bin"), path.join(outside, "bin"), toolsPath({ withNode: false })].join(path.delimiter));
    assert.equal(fs.existsSync(planted) && /^node/m.test(fs.readFileSync(planted, "utf8")), false, `${rel}: the planted node ran`);
    assert.equal(fs.existsSync(log), false, rel);
    assert.equal(fs.existsSync(marker), false, rel);
    refused(rel, r, /no node on PATH outside this checkout/);
  }
});

test("PR #369 round 3: sourcing gxt-runtime-env.sh leaves no _gxt_* function, no top, and the caller's directory, PATH and OLDPWD", () => {
  for (const installed of [true, false]) {
    const { dest } = repo();
    fs.mkdirSync(path.join(dest, "sub"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "og-launch-leak-"));
    stub(path.join(outside, "bin"), path.join(outside, "calls.log"));
    const PATH = installed ? `${path.join(outside, "bin")}${path.delimiter}${toolsPath()}` : toolsPath();
    const script = [
      "cd /",
      `cd ${JSON.stringify(path.join(dest, "sub"))}`,
      'before_pwd="$PWD" before_old="$OLDPWD" before_path="$PATH"',
      "source ../scripts/gxt-runtime-env.sh",
      "rc=$?",
      'echo "rc=$rc"',
      "echo \"functions=[$(compgen -A function _gxt_ | while read -r f; do printf '%s ' \"$f\"; done)]\"",
      'echo "top=${top-unset}"',
      '[[ "$PWD" == "$before_pwd" && "$(pwd -P)" == "$(cd "$before_pwd" && pwd -P)" ]] && echo cwd=same',
      '[[ "$OLDPWD" == "$before_old" ]] && echo oldpwd=same',
      '[[ "$PATH" == "$before_path" ]] && echo path=same',
      'echo "mission=${GANTRY_MISSION_FILE:-}"',
    ].join("\n");
    // No GANTRY_* from the shell running the tests (an executor's runtime env exports GANTRY_MISSION_FILE).
    const env = Object.fromEntries(Object.entries(gitChildEnv({ PATH })).filter(([k]) => !k.startsWith("GANTRY_")));
    const r = spawnSync("bash", ["-c", script], { cwd: dest, env, encoding: "utf8", input: "" });
    const out = r.stdout;
    assert.match(out, installed ? /rc=0/ : /rc=1/, `${out}${r.stderr}`);
    assert.match(out, /functions=\[\]/, out);
    assert.match(out, /top=unset/, out);
    assert.match(out, /cwd=same/, out);
    assert.match(out, /oldpwd=same/, out);
    assert.match(out, /path=same/, out);
    assert.match(out, installed ? /mission=installed/ : /mission=$/m, out);
  }
});
