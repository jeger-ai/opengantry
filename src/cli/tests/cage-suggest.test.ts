import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getRepoRoot, gitChildEnv } from "../lib/git/git.js";
import { runCage } from "../lib/cage/cage-run.js";
import { loadCageConfig } from "../lib/cage/cage-config.js";
import {
  CAGE_SESSION_ENV,
  CAGE_SUGGESTED_FILE,
  assertOutsideCageSession,
  formatCageSuggestionsYaml,
  suggestCageRules,
} from "../lib/cage/cage-suggest.js";
import { registerGxtMcpTools } from "../lib/mcp/mcp-tools-register.js";
import { isSuggestInvocation } from "../program-cage.js";

const CLI = path.join(getRepoRoot(), "dist", "cli", "index.js");

function touch(dest: string, rel: string, body = "x\n"): void {
  fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
  fs.writeFileSync(path.join(dest, rel), body);
}

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
    env: gitChildEnv(),
  });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
}

/** A repo with one anchor per category, plus decoys in build and dependency trees. */
function makeAnchoredRepo(prefix: string): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(dest, ["init", "-q"]);
  for (const rel of [
    "db/migrations/001_init.sql",
    "services/api/migrations/0001.py",
    "deploy/k8s/app.yaml",
    "infra/main.tf",
    "infra/prod.tfvars",
    "Dockerfile",
    "services/api/Dockerfile.dev",
    ".npmrc",
    ".github/CODEOWNERS",
    ".github/actions/setup/action.yml",
    "Jenkinsfile",
    "certs/server.pem",
    ".github/workflows/ci.yml",
    "node_modules/pkg/Dockerfile",
    "dist/Jenkinsfile",
    "src/app.ts",
  ]) {
    touch(dest, rel);
  }
  return dest;
}

function cli(dest: string, args: string[], env: NodeJS.ProcessEnv = gitChildEnv()): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dest, encoding: "utf8", env });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Code-point order: `*` (0x2A) sorts before `.` (0x2E). */
const EXPECTED = [
  ["glob", "**/*.pem", "keys"],
  ["glob", "**/*.tf", "infrastructure"],
  ["glob", "**/*.tfvars", "infrastructure"],
  ["path", ".github/CODEOWNERS", "code_owners"],
  ["path", ".github/actions", "ci"],
  ["path", ".npmrc", "package_registry"],
  ["path", "Dockerfile", "container"],
  ["path", "Jenkinsfile", "ci"],
  ["path", "db/migrations", "migrations"],
  ["path", "deploy/k8s", "infrastructure"],
  ["path", "services/api/Dockerfile.dev", "container"],
  ["path", "services/api/migrations", "migrations"],
];

test("cage suggest: a gantry cage subcommand; cage -- suggest and the standalone bin still run a command (MSN-0240 DoD 1)", () => {
  assert.equal(isSuggestInvocation(["suggest"], ["node", "gantry", "cage", "suggest"]), true);
  assert.equal(isSuggestInvocation(["suggest"], ["node", "gantry", "cage", "--json", "suggest", "--write"]), true);
  assert.equal(isSuggestInvocation(["suggest"], ["node", "gantry", "cage", "--", "suggest"]), false);
  assert.equal(isSuggestInvocation(["suggest", "x"], ["node", "gantry", "cage", "--json", "--", "suggest", "x"]), false);
  assert.equal(isSuggestInvocation(["ls"], ["node", "gantry", "cage", "ls"]), false);

  const dest = makeAnchoredRepo("og-cage-suggest-cmd-");
  const sub = cli(dest, ["cage", "suggest"]);
  assert.equal(sub.status, 0, sub.stderr);
  assert.match(sub.stdout, /^protect:$/m);

  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-fakebin-"));
  fs.writeFileSync(path.join(bin, "suggest"), "#!/bin/sh\necho wrapped > wrapped-ran.txt\n", { mode: 0o755 });
  const env = { ...gitChildEnv(), PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` };
  const wrapped = cli(dest, ["cage", "--json", "--", "suggest"], env);
  assert.equal(wrapped.status, 0, wrapped.stderr);
  assert.equal((JSON.parse(wrapped.stdout) as { command: string }).command, "suggest");
  assert.equal(fs.readFileSync(path.join(dest, "wrapped-ran.txt"), "utf8"), "wrapped\n");
  fs.rmSync(path.join(dest, "wrapped-ran.txt"));

  const standalone = spawnSync(process.execPath, [path.join(getRepoRoot(), "dist", "cli", "cage-bin.js"), "suggest"], {
    cwd: dest,
    encoding: "utf8",
    env,
  });
  assert.equal(standalone.status, 0, standalone.stderr);
  assert.ok(fs.existsSync(path.join(dest, "wrapped-ran.txt")), "opengantry-cage suggest runs the command named suggest");
});

test("cage suggest: static anchors with reasons, sorted, skipping covered paths and build trees; parses as .cage.yaml (MSN-0240 DoD 2)", () => {
  const dest = makeAnchoredRepo("og-cage-suggest-heur-");
  const result = suggestCageRules(dest);
  assert.deepEqual(result.suggestions.map((s) => [s.kind, s.value, s.category]), EXPECTED);
  for (const s of result.suggestions) {
    assert.equal(s.mode, "revert");
    assert.ok(s.reason.length > 0, s.value);
  }
  assert.deepEqual(suggestCageRules(dest), result, "deterministic");

  const yaml = formatCageSuggestionsYaml(result, false);
  const check = fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-suggest-parse-"));
  fs.writeFileSync(path.join(check, ".cage.yaml"), yaml);
  const loaded = loadCageConfig(check);
  assert.deepEqual(loaded.entries, result.suggestions.map((s) => ({ kind: s.kind, value: s.value, mode: s.mode })));

  fs.writeFileSync(path.join(dest, ".cage.yaml"), 'protect:\n  - path: deploy/k8s\n  - glob: "**/*.pem"\n');
  const covered = suggestCageRules(dest);
  const values = covered.suggestions.map((s) => s.value);
  assert.ok(!values.includes("deploy/k8s") && !values.includes("**/*.pem"), "existing .cage.yaml entries are not proposed again");
  assert.equal(covered.already_covered, 2);
  assert.match(formatCageSuggestionsYaml(covered, true), /add the ones you want to the protect: list in \.cage\.yaml/);
});

test("cage suggest: proposal only; --write creates .cage.yaml.suggested, never .cage.yaml, and cage ignores it (MSN-0240 DoD 3)", async () => {
  const dest = makeAnchoredRepo("og-cage-suggest-write-");
  const first = cli(dest, ["cage", "suggest", "--write"]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, "");
  assert.match(first.stderr, /wrote \.cage\.yaml\.suggested \(12 entries/);
  const suggested = path.join(dest, CAGE_SUGGESTED_FILE);
  assert.match(fs.readFileSync(suggested, "utf8"), /cage never reads this proposal/);
  assert.equal(fs.existsSync(path.join(dest, ".cage.yaml")), false);

  const again = cli(dest, ["cage", "suggest", "--write"]);
  assert.equal(again.status, 2);
  assert.match(again.stderr, /\[GXT_CAGE_SUGGEST_EXISTS\].*\.cage\.yaml\.suggested already exists/);
  fs.writeFileSync(suggested, "stale\n");
  const forced = cli(dest, ["cage", "suggest", "--write", "--force"]);
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(fs.readFileSync(suggested, "utf8"), /^protect:$/m);

  const json = cli(dest, ["cage", "suggest", "--json"]);
  const parsed = JSON.parse(json.stdout) as { suggestions: unknown[]; written: string | null };
  assert.equal(parsed.suggestions.length, 12);
  assert.equal(parsed.written, null);

  fs.writeFileSync(suggested, "relax: [everything]\n");
  const report = await runCage({ cwd: dest, watch: false, command: [process.execPath, "-e", ""] });
  assert.deepEqual(report.cage_config, { present: false, entries: 0, committed: null }, "cage never loads the proposal");
  assert.equal(report.status, "ok");
});

test("cage suggest: cage marks its session and suggest refuses to run inside it (MSN-0240 DoD 4)", async () => {
  assert.throws(
    () => assertOutsideCageSession({ [CAGE_SESSION_ENV]: "1" }),
    (err: Error & { code?: string }) => /refused inside a cage session/.test(err.message) && err.code === "GXT_CAGE_SUGGEST_IN_SESSION",
  );
  assert.doesNotThrow(() => assertOutsideCageSession({}));

  const dest = makeAnchoredRepo("og-cage-suggest-session-");
  const script = `
    const { spawnSync } = require("child_process");
    const fs = require("fs");
    fs.writeFileSync("probe-env.txt", String(process.env.${CAGE_SESSION_ENV}));
    const r = spawnSync(process.execPath, [${JSON.stringify(CLI)}, "cage", "suggest", "--write"], { encoding: "utf8" });
    fs.writeFileSync("probe-suggest.txt", String(r.status) + "\\n" + r.stderr);
  `;
  await runCage({ cwd: dest, watch: false, command: [process.execPath, "-e", script] });
  assert.equal(fs.readFileSync(path.join(dest, "probe-env.txt"), "utf8"), "1");
  const [status, ...stderr] = fs.readFileSync(path.join(dest, "probe-suggest.txt"), "utf8").split("\n");
  assert.equal(status, "2");
  assert.match(stderr.join("\n"), /refused inside a cage session/);
  assert.equal(fs.existsSync(path.join(dest, CAGE_SUGGESTED_FILE)), false);
});

test("cage suggest: no gxt_* MCP tool exposes cage rule authoring (MSN-0240 DoD 5)", () => {
  const tools: { name: string; description: string }[] = [];
  const fakeServer = {
    tool: (name: string, description: string) => {
      tools.push({ name, description });
    },
  } as unknown as McpServer;
  registerGxtMcpTools(fakeServer);
  assert.ok(tools.length > 10, "registry was read");
  for (const t of tools) {
    assert.doesNotMatch(t.name, /cage|suggest/i, t.name);
    assert.doesNotMatch(t.description, /cage suggest|\.cage\.yaml/i, t.name);
  }
});

test("cage: warns when .cage.yaml is untracked or uncommitted; the report says cage_config.committed (MSN-0240 DoD 6)", () => {
  const dest = makeAnchoredRepo("og-cage-committed-");
  fs.writeFileSync(path.join(dest, ".cage.yaml"), "protect:\n  - path: infra\n");
  const warning = "cage: warning: .cage.yaml is untracked or has uncommitted changes; review and commit it";
  const run = (): { committed: boolean | null; warned: boolean; status: number | null } => {
    const r = cli(dest, ["cage", "--json", "--no-watch", "--", process.execPath, "-e", ""]);
    const report = JSON.parse(r.stdout) as { cage_config: { committed: boolean | null } };
    return { committed: report.cage_config.committed, warned: r.stderr.includes(warning), status: r.status };
  };
  assert.deepEqual(run(), { committed: false, warned: true, status: 0 }, "untracked");
  git(dest, ["add", ".cage.yaml"]);
  git(dest, ["commit", "-qm", "cage config"]);
  assert.deepEqual(run(), { committed: true, warned: false, status: 0 }, "committed");
  fs.appendFileSync(path.join(dest, ".cage.yaml"), "  - path: deploy\n");
  assert.deepEqual(run(), { committed: false, warned: true, status: 0 }, "modified, not aborted");

  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-committed-nogit-"));
  fs.writeFileSync(path.join(plain, ".cage.yaml"), "protect: []\n");
  const r = cli(plain, ["cage", "--json", "--no-watch", "--", process.execPath, "-e", ""]);
  assert.equal((JSON.parse(r.stdout) as { cage_config: { committed: boolean | null } }).cage_config.committed, null);
  assert.ok(!r.stderr.includes(warning), "no warning outside git");
});

test("cage suggest: proposes committed git hook config unless it is the active hooks path (MSN-0242 DoD 1, DoD 2)", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-suggest-hooks-"));
  git(dest, ["init", "-q"]);
  for (const rel of [".githooks/pre-push", ".husky/pre-commit", ".pre-commit-config.yaml", "lefthook.yml", "tools/lefthook.yaml", ".lefthook.yml"]) {
    touch(dest, rel);
  }
  const result = suggestCageRules(dest);
  assert.deepEqual(
    result.suggestions.map((s) => [s.kind, s.value, s.category]),
    [
      ["path", ".githooks", "git_hooks"],
      ["path", ".husky", "git_hooks"],
      ["path", ".lefthook.yml", "git_hooks"],
      ["path", ".pre-commit-config.yaml", "git_hooks"],
      ["path", "lefthook.yml", "git_hooks"],
      ["path", "tools/lefthook.yaml", "git_hooks"],
    ],
  );
  for (const s of result.suggestions) assert.match(s.reason, /hook/);
  assert.equal(result.already_covered, 0);

  git(dest, ["config", "core.hooksPath", ".githooks"]);
  const active = suggestCageRules(dest);
  assert.ok(!active.suggestions.some((s) => s.value === ".githooks"), "the active hooks path is already git_control");
  assert.equal(active.already_covered, 1);
  assert.equal(active.suggestions.length, 5);
});
