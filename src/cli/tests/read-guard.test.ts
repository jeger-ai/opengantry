import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getRepoRoot } from "#git/git.js";
import { readGuard } from "#cage/read-guard.js";

const CAGE_BIN = path.join(getRepoRoot(), "dist", "cli", "cage-bin.js");
const ENV = { home: "/home/dev", cwd: "/repo" };

function claude(tool: string, toolInput: Record<string, unknown>, cwd = "/repo"): string {
  return JSON.stringify({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: toolInput, cwd, session_id: "s" });
}

test("read guard, Claude Code: Read, Edit, NotebookEdit and Grep of a secret are denied with a reason; other files and tools get no decision (MSN-0343)", () => {
  const denied = readGuard(claude("Read", { file_path: "/repo/.env.local" }), ENV);
  assert.equal(denied.exitCode, 0);
  const out = JSON.parse(denied.stdout) as { hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason: string } };
  assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /\/repo\/\.env\.local \(secret_file\)/);

  assert.equal(readGuard(claude("Edit", { file_path: "/home/dev/.aws/credentials", old_string: "a", new_string: "b" }), ENV).denied[0]?.rule, "home_credentials");
  assert.equal(readGuard(claude("NotebookEdit", { notebook_path: "/repo/.env" }), ENV).denied.length, 1);
  assert.equal(readGuard(claude("Grep", { pattern: "KEY", path: "/home/dev/.ssh" }), ENV).denied.length, 1);
  for (const [tool, input] of [
    ["Read", { file_path: "/repo/.env.example" }],
    ["Read", { file_path: "/repo/src/app.ts" }],
    ["Write", { file_path: "/repo/.env", content: "x" }],
    ["Glob", { pattern: "**/.env*" }],
    ["Grep", { pattern: "x" }],
    ["WebFetch", { url: "https://example.com/.env" }],
  ] as const) {
    const r = readGuard(claude(tool, input), ENV);
    assert.deepEqual([r.stdout, r.exitCode], ["", 0], `${tool} ${JSON.stringify(input)}: no decision`);
  }
});

test("read guard, Claude Code Bash: words naming a secret file are denied; relative paths resolve against cwd (MSN-0343)", () => {
  const cases: [string, number][] = [
    ["cat .env", 1],
    ["source ./config/.env.production && npm start", 1],
    ["grep -r TOKEN ~/.aws", 1],
    ['less "$HOME/.ssh/config" || cat \'~/.ssh/id_rsa\'', 2],
    ["node app.js --env-file=.env", 1],
    ["git -C sub cat-file -p HEAD:.git/config", 0],
    ["cat .env.example README.md src/index.ts", 0],
    ["npm test", 0],
  ];
  for (const [command, n] of cases) {
    assert.equal(readGuard(claude("Bash", { command }), ENV).denied.length, n, command);
  }
  assert.equal(readGuard(claude("Bash", { command: "cat ../.env" }, "/repo/app"), ENV).denied[0]?.path, "/repo/.env");
  assert.deepEqual(readGuard(claude("Bash", { command: "cat ${HOME}/.npmrc" }), ENV).denied, [{ path: "/home/dev/.npmrc", rule: "home_credentials" }]);
});

test("read guard, Cursor: beforeReadFile, beforeTabFileRead and beforeShellExecution answer allow or deny with messages (MSN-0343)", () => {
  const read = (file: string, event = "beforeReadFile") => JSON.parse(readGuard(JSON.stringify({ hook_event_name: event, file_path: file, content: "SECRET=1", workspace_roots: ["/repo"] }), ENV).stdout) as Record<string, string>;
  assert.deepEqual(read("/repo/src/a.ts"), { permission: "allow" });
  const denied = read("/repo/.env");
  assert.equal(denied.permission, "deny");
  assert.match(denied.user_message ?? "", /\/repo\/\.env \(secret_file\)/);
  assert.equal(denied.agent_message, undefined, "beforeReadFile has no agent_message");
  assert.equal(read("/home/dev/.netrc", "beforeTabFileRead").permission, "deny");

  const shell = (command: string) => JSON.parse(readGuard(JSON.stringify({ hook_event_name: "beforeShellExecution", command, cwd: "/repo/app", workspace_roots: ["/repo"] }), ENV).stdout) as Record<string, string>;
  assert.deepEqual(shell("ls"), { permission: "allow" });
  const sh = shell("cat ../.env");
  assert.equal(sh.permission, "deny");
  assert.equal(sh.agent_message, sh.user_message);
});

test("read guard: input that is not a hook payload blocks with exit 2; an event it does not judge passes (MSN-0343)", () => {
  for (const text of ["", "not json", "[]", '{"tool_name":"Read"}']) {
    const r = readGuard(text, ENV);
    assert.equal(r.exitCode, 2, text);
    assert.match(r.stderr, /refusing the call/);
  }
  assert.deepEqual(readGuard(JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "/repo/.env" } }), ENV), { stdout: "", stderr: "", exitCode: 0, denied: [] });
});

test("gantry-cage read-guard and gantry read-guard: stdin to the agent's decision (MSN-0343)", () => {
  const home = process.env.HOME ?? "/root";
  const input = claude("Read", { file_path: path.join(home, ".ssh", "id_ed25519") });
  for (const args of [[CAGE_BIN, "read-guard"], [path.join(getRepoRoot(), "dist", "cli", "index.js"), "read-guard"]]) {
    const r = spawnSync(process.execPath, args, { input, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal((JSON.parse(r.stdout) as { hookSpecificOutput: { permissionDecision: string } }).hookSpecificOutput.permissionDecision, "deny");
  }
  const bad = spawnSync(process.execPath, [CAGE_BIN, "read-guard"], { input: "x", encoding: "utf8" });
  assert.equal(bad.status, 2);
});
