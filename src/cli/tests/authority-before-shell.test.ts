/**
 * MSN-0390 (issue #356, follow-up of MSN-0385): the Cursor beforeShellExecution hook runs before every shell command
 * the agent starts. It starts on #!/bin/bash and sanitizes PATH with the shared resolver block before it looks anything
 * up, so a bash or a node the agent plants in the checkout (node_modules/.bin first on PATH, as npm run and direnv put
 * it) never runs in the human's environment. Its contract with Cursor is unchanged: one JSON decision on stdout,
 * {"permission":"allow"} or {"permission":"ask",user_message,agent_message}, and exit 0.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getRepoRoot, gitChildEnv } from "#git/git.js";

const OG = getRepoRoot();
const HOOK = ".cursor/hooks/gxt-before-shell.sh";

/** The tools the hook and the planted stubs run by name. grep is the hook's own; the rest is what the resolver uses. */
const TOOLS = ["bash", "sh", "git", "grep", "sed", "head", "readlink", "dirname", "cat"] as const;

/** A PATH directory with links to node and exactly the tools above, outside any checkout. */
function toolsPath({ withNode = true }: { withNode?: boolean } = {}): string {
  const tools = fs.mkdtempSync(path.join(os.tmpdir(), "og-shell-tools-"));
  if (withNode) fs.symlinkSync(process.execPath, path.join(tools, "node"));
  for (const tool of TOOLS) {
    const found = ["/usr/local/bin", "/usr/bin", "/bin"].map((d) => path.join(d, tool)).find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
    assert.ok(found, `${tool} is needed by the hook tests`);
    fs.symlinkSync(found, path.join(tools, tool));
  }
  return tools;
}

/** A checkout (a git repository) holding a copy of the hook. */
function checkout(): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-shell-"));
  spawnSync("git", ["init", "-q"], { cwd: dest, env: gitChildEnv() });
  fs.mkdirSync(path.join(dest, ".cursor", "hooks"), { recursive: true });
  fs.copyFileSync(path.join(OG, HOOK), path.join(dest, HOOK));
  fs.chmodSync(path.join(dest, HOOK), 0o755);
  return dest;
}

/** A bash and a node planted in the checkout: each leaves a marker line, then does the real thing. */
function plant(dir: string, marker: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "bash"), `#!/bin/sh\necho "bash $*" >> '${marker}'\nexec /bin/bash "$@"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, "node"), `#!/bin/sh\necho "node $*" >> '${marker}'\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 });
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** The hook as Cursor runs it: the file itself (the kernel reads line 1), the command JSON on stdin. */
function hook(dest: string, input: string, PATH: string, opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Run {
  const env = gitChildEnv({ PATH });
  for (const k of ["GANTRY_HOOK_LOCAL_BUILD", "GANTRY_MCP_LOCAL_BUILD", "CURSOR_PROJECT_DIR", "CLAUDE_PROJECT_DIR"]) delete env[k];
  Object.assign(env, opts.env ?? {});
  const r = spawnSync(path.join(dest, HOOK), [], { cwd: opts.cwd ?? dest, env, encoding: "utf8", input });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** The one decision the hook wrote on stdout. */
function decision(r: Run): { permission: string; user_message?: string; agent_message?: string } {
  assert.equal(r.status, 0, `the hook exits 0: ${r.stderr}`);
  assert.ok(r.stdout.endsWith("\n"), `one line on stdout: ${JSON.stringify(r.stdout)}`);
  assert.equal(r.stdout.trimEnd().split("\n").length, 1, `one line on stdout: ${JSON.stringify(r.stdout)}`);
  return JSON.parse(r.stdout) as { permission: string; user_message?: string; agent_message?: string };
}

const cmd = (command: string): string => JSON.stringify({ command, cwd: "/x", hook_event_name: "beforeShellExecution" });

const ALLOW = [cmd("ls -la"), "", "not json", cmd(""), cmd("gantry legislated --help"), JSON.stringify({ other: 1 })];
const ASK_LAW = [cmd("echo x > .gitagent/foreman/MANIFEST.yaml"), cmd("sed -i s/a/b/ .gitagent/planner/RULES.md")];
const ASK_LEGISLATE = [cmd("gantry legislate --msn MSN-0001 x"), cmd("npx gantry  legislate x"), cmd("cd a &&\ngantry legislate x"), cmd("./node_modules/.bin/gantry legislate x")];

function assertContract(dest: string, PATH: string, opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): void {
  for (const input of ALLOW) assert.deepEqual(decision(hook(dest, input, PATH, opts)), { permission: "allow" }, input);
  for (const input of ASK_LAW) {
    const d = decision(hook(dest, input, PATH, opts));
    assert.equal(d.permission, "ask", input);
    assert.match(d.user_message ?? "", /touches GXT law or manifest/, input);
    assert.match(d.agent_message ?? "", /require Planner legislation/, input);
  }
  for (const input of ASK_LEGISLATE) {
    const d = decision(hook(dest, input, PATH, opts));
    assert.equal(d.permission, "ask", input);
    assert.match(d.user_message ?? "", /runs gantry legislate directly/, input);
    assert.match(d.agent_message ?? "", /Prefer MCP/, input);
  }
}

test("before-shell hook: the hook and its template start on #!/bin/bash and are byte-identical", () => {
  const text = fs.readFileSync(path.join(OG, HOOK), "utf8");
  assert.equal(text.split("\n")[0], "#!/bin/bash");
  assert.equal(fs.readFileSync(path.join(OG, "templates", HOOK), "utf8"), text);
});

test("before-shell hook: the JSON decision Cursor reads on stdout is unchanged (allow, ask on law, ask on legislate)", () => {
  const dest = checkout();
  assertContract(dest, toolsPath());
});

test(
  "before-shell hook: a bash or node planted in node_modules/.bin, first on PATH, never runs and the decision is the same",
  { skip: fs.existsSync("/bin/bash") ? false : "no /bin/bash" },
  () => {
    for (const layout of ["node_modules/.bin", "bin"] as const) {
      const dest = checkout();
      const marker = path.join(os.tmpdir(), `og-shell-planted-${path.basename(dest)}`);
      plant(path.join(dest, layout), marker);
      // npm run and direnv put <checkout>/node_modules/.bin first; profiles add relative entries.
      const PATH = [path.join(dest, layout), layout, toolsPath()].join(path.delimiter);
      assertContract(dest, PATH);
      assert.equal(fs.existsSync(marker), false, `${layout}: a planted tool ran: ${fs.existsSync(marker) ? fs.readFileSync(marker, "utf8") : ""}`);
    }
  },
);

test("before-shell hook: with no node outside the checkout it asks, with the reason, and the planted node never runs", () => {
  const dest = checkout();
  const marker = path.join(os.tmpdir(), `og-shell-nonode-${path.basename(dest)}`);
  plant(path.join(dest, "node_modules", ".bin"), marker);
  const PATH = [path.join(dest, "node_modules", ".bin"), toolsPath({ withNode: false })].join(path.delimiter);
  for (const input of [cmd("ls"), cmd("echo x > .gitagent/foreman/MANIFEST.yaml")]) {
    const d = decision(hook(dest, input, PATH));
    assert.equal(d.permission, "ask", input);
    assert.match(d.user_message ?? "", /no node on PATH outside this checkout/, input);
    assert.match(d.agent_message ?? "", /no node on PATH outside this checkout/, input);
  }
  assert.equal(fs.existsSync(marker), false, `the planted tool ran: ${fs.existsSync(marker) ? fs.readFileSync(marker, "utf8") : ""}`);
});

test("before-shell hook: the checkout is CURSOR_PROJECT_DIR or the hook's location, never the git repository around the working directory", () => {
  // Cursor names the project; the working directory is elsewhere. A node in <checkout>/bin is inside.
  {
    const dest = checkout();
    const marker = path.join(os.tmpdir(), `og-shell-cursordir-${path.basename(dest)}`);
    plant(path.join(dest, "bin"), marker);
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "og-shell-cwd-"));
    assertContract(dest, [path.join(dest, "bin"), toolsPath()].join(path.delimiter), { cwd: elsewhere, env: { CURSOR_PROJECT_DIR: dest } });
    assert.equal(fs.existsSync(marker), false, "the node in the project Cursor names never ran");
  }
  // No project directory, run from a git repository the agent made inside the checkout: <checkout>/bin is still inside.
  {
    const dest = checkout();
    const deep = path.join(dest, "sub", "deep");
    fs.mkdirSync(deep, { recursive: true });
    spawnSync("git", ["init", "-q"], { cwd: deep, env: gitChildEnv() });
    const marker = path.join(os.tmpdir(), `og-shell-nested-${path.basename(dest)}`);
    plant(path.join(dest, "bin"), marker);
    assertContract(dest, [path.join(dest, "bin"), toolsPath()].join(path.delimiter), { cwd: deep });
    assert.equal(fs.existsSync(marker), false, "the node under the real checkout never ran");
  }
});
