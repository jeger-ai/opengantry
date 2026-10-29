/**
 * `gantry cage policy --agent claude-code` (ADR-0060): the cage's law as a Claude Code settings fragment, pinned.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getRepoRoot, gitChildEnv } from "#git/git.js";
import { CAGE_SESSION_ENV, assertOutsideCageSession, cageAgentPolicy } from "#cage/cage-suggest.js";
import { writeManifest } from "./test-fixtures.js";

const CLI = path.join(getRepoRoot(), "dist", "cli", "index.js");

function makeRepo(prefix: string): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const r = spawnSync("git", ["init", "-q"], { cwd: dest, encoding: "utf8", env: gitChildEnv() });
  assert.equal(r.status, 0, r.stderr);
  return dest;
}

function cli(dest: string, args: string[], extra: NodeJS.ProcessEnv = {}): { status: number | null; stdout: string; stderr: string } {
  const env = gitChildEnv({ ...extra });
  if (!(CAGE_SESSION_ENV in extra)) delete env[CAGE_SESSION_ENV];
  const r = spawnSync(process.execPath, [CLI, "cage", "policy", ...args], { cwd: dest, encoding: "utf8", env });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

interface Fragment {
  permissions: { deny: string[] };
  sandbox: {
    enabled: boolean;
    allowUnsandboxedCommands: boolean;
    filesystem: { denyWrite: string[]; denyRead: string[] };
    credentials: { files: { path: string; mode: string }[] };
  };
}

const HOME = [
  "~/.aws",
  "~/.azure",
  "~/.config/gcloud",
  "~/.config/gh/hosts.yml",
  "~/.docker/config.json",
  "~/.git-credentials",
  "~/.gnupg",
  "~/.kube/config",
  "~/.netrc",
  "~/.npmrc",
  "~/.pypirc",
  "~/.ssh",
];

/** A git repository with no manifest and no .cage.yaml: the built-in floor, the secrets and git control only. */
const BUILTIN: Fragment = {
  permissions: {
    deny: [
      "Edit(**/.env)",
      "Edit(**/.env.*)",
      "Edit(**/.env/**)",
      "Edit(/.cage.yaml)",
      "Edit(/.cage.yaml/**)",
      "Edit(/.circleci)",
      "Edit(/.circleci/**)",
      "Edit(/.git/config)",
      "Edit(/.git/config/**)",
      "Edit(/.git/hooks)",
      "Edit(/.git/hooks/**)",
      "Edit(/.github/workflows)",
      "Edit(/.github/workflows/**)",
      "Edit(/.gitlab-ci.yml)",
      "Edit(/.gitlab-ci.yml/**)",
      "Edit(/azure-pipelines.yml)",
      "Edit(/azure-pipelines.yml/**)",
      "Read(**/.env)",
      "Read(**/.env.*)",
      "Read(**/.env/**)",
      "Read(**/.git-credentials)",
      "Read(**/.git-credentials/**)",
      "Read(**/.git/config)",
      "Read(**/.git/config/**)",
      "Read(**/id_dsa)",
      "Read(**/id_dsa/**)",
      "Read(**/id_ecdsa)",
      "Read(**/id_ecdsa/**)",
      "Read(**/id_ed25519)",
      "Read(**/id_ed25519/**)",
      "Read(**/id_rsa)",
      "Read(**/id_rsa/**)",
      ...HOME.flatMap((h) => [`Read(${h})`, `Read(${h}/**)`]),
    ],
  },
  sandbox: {
    enabled: true,
    allowUnsandboxedCommands: false,
    filesystem: {
      denyWrite: [
        "./**/.env",
        "./**/.env.*",
        "./.cage.yaml",
        "./.circleci",
        "./.git/config",
        "./.git/hooks",
        "./.github/workflows",
        "./.gitlab-ci.yml",
        "./azure-pipelines.yml",
      ],
      denyRead: ["./**/.env", "./**/.env.*", "./**/.git-credentials", "./**/id_dsa", "./**/id_ecdsa", "./**/id_ed25519", "./**/id_rsa", ...HOME],
    },
    credentials: { files: HOME.map((p) => ({ path: p, mode: "deny" })) },
  },
};

test("cage policy: built-ins only give the pinned Claude Code fragment, in stable key order with a trailing newline", () => {
  const dest = makeRepo("og-cage-policy-builtin-");
  const text = cageAgentPolicy(dest, "claude-code");
  assert.equal(text, `${JSON.stringify(BUILTIN, null, 2)}\n`);
  assert.equal(cageAgentPolicy(dest, "claude-code"), text, "deterministic");
  assert.ok(!text.includes("Write("), "Write(...) rules never match in Claude Code; Edit(...) covers them");
});

test("cage policy: .cage.yaml revert entries and manifest forbidden zones join the write denies; report entries do not", () => {
  const dest = makeRepo("og-cage-policy-law-");
  writeManifest(dest, { app: { trust_threshold: "Tier-2", tmvc_roots: ["src/"], forbidden_zones: ["infra/"] } });
  fs.writeFileSync(path.join(dest, ".cage.yaml"), 'protect:\n  - path: db/migrations\n  - glob: "**/*.tf"\n  - path: docs/notes.md\n    mode: report\n');
  const fragment = JSON.parse(cageAgentPolicy(dest, "claude-code")) as Fragment;
  const added = fragment.permissions.deny.filter((r) => !BUILTIN.permissions.deny.includes(r));
  assert.deepEqual(added, ["Edit(**/*.tf)", "Edit(/db/migrations)", "Edit(/db/migrations/**)", "Edit(/infra)", "Edit(/infra/**)"]);
  const writes = fragment.sandbox.filesystem.denyWrite.filter((p) => !BUILTIN.sandbox.filesystem.denyWrite.includes(p));
  assert.deepEqual(writes, ["./**/*.tf", "./db/migrations", "./infra"]);
  assert.deepEqual(fragment.sandbox.filesystem.denyRead, BUILTIN.sandbox.filesystem.denyRead);

  fs.writeFileSync(path.join(dest, ".cage.yaml"), "protect: []\ndependencies: revert\n");
  const frozen = JSON.parse(cageAgentPolicy(dest, "claude-code")) as Fragment;
  assert.ok(frozen.permissions.deny.includes("Edit(**/package-lock.json)") && frozen.permissions.deny.includes("Edit(**/package.json)"), "a dependency freeze denies lockfiles and manifests");
  assert.ok(!fragment.permissions.deny.includes("Edit(**/package-lock.json)"), "lockfiles are report-only without a freeze");
});

test("cage policy: --contract adds forbidden_paths; two runs print the same bytes; --json wraps the settings", () => {
  const dest = makeRepo("og-cage-policy-contract-");
  fs.writeFileSync(path.join(dest, "verify.yaml"), 'schema: opengantry.verify.v1\nscope:\n  forbidden_paths: [".github/", "./legacy/**", "src/gen"]\n');
  const first = cli(dest, ["--agent", "claude-code", "--contract", "verify.yaml"]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(cli(dest, ["--agent", "claude-code", "--contract", "verify.yaml"]).stdout, first.stdout, "byte-identical");
  assert.match(first.stderr, /review it, then merge it into \.claude\/settings\.json/);
  const fragment = JSON.parse(first.stdout) as Fragment;
  const added = fragment.permissions.deny.filter((r) => !BUILTIN.permissions.deny.includes(r));
  assert.deepEqual(added, ["Edit(/.github)", "Edit(/.github/**)", "Edit(/legacy/**)", "Edit(/src/gen)", "Edit(/src/gen/**)"]);
  assert.deepEqual(fragment.sandbox.filesystem.denyWrite.filter((p) => !BUILTIN.sandbox.filesystem.denyWrite.includes(p)), ["./.github", "./legacy/**", "./src/gen"]);

  const json = cli(dest, ["--agent", "claude-code", "--contract", "verify.yaml", "--json"]);
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), { agent: "claude-code", written: null, settings: fragment });

  fs.writeFileSync(path.join(dest, "bad.yaml"), 'schema: opengantry.verify.v1\nscope:\n  forbidden_paths: ["../outside"]\n');
  const bad = cli(dest, ["--agent", "claude-code", "--contract", "bad.yaml"]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /\[GXT_CAGE_POLICY_INVALID\].*not root-relative/);
});

test("cage policy: --agent must be claude-code (exit 2)", () => {
  const dest = makeRepo("og-cage-policy-agent-");
  const unknown = cli(dest, ["--agent", "codex"]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /\[GXT_CAGE_POLICY_INVALID\].*unknown agent codex/);
  assert.ok(!unknown.stdout.includes("permissions"), "no fragment");
  const missing = cli(dest, []);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /\[GXT_CAGE_POLICY_INVALID\].*--agent is required/);
  const json = cli(dest, ["--agent", "codex", "--json"]);
  assert.equal(json.status, 2);
  assert.equal((JSON.parse(json.stdout) as { error_code: string }).error_code, "GXT_CAGE_POLICY_INVALID");
});

test("cage policy: --out writes the printed fragment and refuses to replace a file without --force", () => {
  const dest = makeRepo("og-cage-policy-out-");
  const printed = cli(dest, ["--agent", "claude-code"]).stdout;
  const first = cli(dest, ["--agent", "claude-code", "--out", "policy.json"]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, "");
  assert.match(first.stderr, /wrote policy\.json/);
  const out = path.join(dest, "policy.json");
  assert.equal(fs.readFileSync(out, "utf8"), printed);

  fs.writeFileSync(out, "mine\n");
  const again = cli(dest, ["--agent", "claude-code", "--out", "policy.json"]);
  assert.equal(again.status, 2);
  assert.match(again.stderr, /\[GXT_CAGE_POLICY_EXISTS\].*policy\.json already exists/);
  assert.equal(fs.readFileSync(out, "utf8"), "mine\n");
  const forced = cli(dest, ["--agent", "claude-code", "--out", "policy.json", "--force"]);
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(fs.readFileSync(out, "utf8"), printed);
  assert.equal(fs.existsSync(path.join(dest, ".claude")), false, "never touches the agent's settings");
});

test("cage policy: refused inside a cage session", () => {
  assert.throws(
    () => assertOutsideCageSession({ [CAGE_SESSION_ENV]: "1" }, "policy"),
    (err: Error & { code?: string }) => err.code === "GXT_CAGE_POLICY_IN_SESSION" && /cage policy: refused inside a cage session/.test(err.message),
  );
  const dest = makeRepo("og-cage-policy-session-");
  const inside = cli(dest, ["--agent", "claude-code", "--out", "policy.json"], { [CAGE_SESSION_ENV]: "1" });
  assert.equal(inside.status, 2);
  assert.match(inside.stderr, /\[GXT_CAGE_POLICY_IN_SESSION\]/);
  assert.equal(fs.existsSync(path.join(dest, "policy.json")), false);
});
