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
// The pinned fragment is the one without a GANTRY_STATE_DIR override; test-tmpdir-setup sets one for the draft token.
delete process.env.GANTRY_STATE_DIR;

function makeRepo(prefix: string): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const r = spawnSync("git", ["init", "-q"], { cwd: dest, encoding: "utf8", env: gitChildEnv() });
  assert.equal(r.status, 0, r.stderr);
  return dest;
}

function cli(dest: string, args: string[], extra: NodeJS.ProcessEnv = {}): { status: number | null; stdout: string; stderr: string } {
  const env = gitChildEnv({ ...extra });
  if (!(CAGE_SESSION_ENV in extra)) delete env[CAGE_SESSION_ENV];
  if (!("GANTRY_STATE_DIR" in extra)) delete env.GANTRY_STATE_DIR;
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
  "~/.opengantry",
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
      "Edit(/.git/opengantry)",
      "Edit(/.git/opengantry/**)",
      "Edit(/.github/workflows)",
      "Edit(/.github/workflows/**)",
      "Edit(/.gitlab-ci.yml)",
      "Edit(/.gitlab-ci.yml/**)",
      "Edit(/azure-pipelines.yml)",
      "Edit(/azure-pipelines.yml/**)",
      "Edit(~/.opengantry)",
      "Edit(~/.opengantry/**)",
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
      "Read(/.git/opengantry)",
      "Read(/.git/opengantry/**)",
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
        "./.git/opengantry",
        "./.github/workflows",
        "./.gitlab-ci.yml",
        "./azure-pipelines.yml",
        "~/.opengantry",
      ],
      denyRead: ["./**/.env", "./**/.env.*", "./**/.git-credentials", "./**/id_dsa", "./**/id_ecdsa", "./**/id_ed25519", "./**/id_rsa", "./.git/opengantry", ...HOME],
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

test("cage policy: a GANTRY_STATE_DIR set when it runs is denied too (absolute as //path in rules, /path in the sandbox)", () => {
  const dest = makeRepo("og-cage-policy-statedir-");
  const extraOf = (env: NodeJS.ProcessEnv) => {
    const f = JSON.parse(cageAgentPolicy(dest, "claude-code", [], env)) as Fragment & { sandbox: { credentials: { files: { path: string }[] } } };
    return {
      deny: f.permissions.deny.filter((r) => !BUILTIN.permissions.deny.includes(r)),
      denyWrite: f.sandbox.filesystem.denyWrite.filter((p) => !BUILTIN.sandbox.filesystem.denyWrite.includes(p)),
      denyRead: f.sandbox.filesystem.denyRead.filter((p) => !BUILTIN.sandbox.filesystem.denyRead.includes(p)),
      credentials: f.sandbox.credentials.files.map((c) => c.path).filter((p) => !BUILTIN.sandbox.credentials.files.some((c) => c.path === p)),
    };
  };
  const none = { deny: [], denyWrite: [], denyRead: [], credentials: [] };
  assert.deepEqual(extraOf({}), none, "unset: the pinned fragment");
  assert.deepEqual(extraOf({ GANTRY_STATE_DIR: "relative/state" }), none, "relative: the draft token refuses it");
  assert.deepEqual(extraOf({ GANTRY_STATE_DIR: "/srv/og-state" }), {
    deny: ["Edit(//srv/og-state)", "Edit(//srv/og-state/**)", "Read(//srv/og-state)", "Read(//srv/og-state/**)"],
    denyWrite: ["/srv/og-state"],
    denyRead: ["/srv/og-state"],
    credentials: ["/srv/og-state"],
  });
  assert.deepEqual(extraOf({ GANTRY_STATE_DIR: path.join(os.homedir(), "state", "og") }), {
    deny: ["Edit(~/state/og)", "Edit(~/state/og/**)", "Read(~/state/og)", "Read(~/state/og/**)"],
    denyWrite: ["~/state/og"],
    denyRead: ["~/state/og"],
    credentials: ["~/state/og"],
  });
});

test("cage policy: a symlinked state dir is denied at the physical path too, where the draft token writes its key (review round 2)", () => {
  const dest = makeRepo("og-cage-policy-statelink-");
  const real = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-policy-real-")));
  const linkParent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-policy-link-")));
  const link = path.join(linkParent, "state");
  fs.symlinkSync(real, link);
  const f = JSON.parse(cageAgentPolicy(dest, "claude-code", [], { GANTRY_STATE_DIR: link })) as Fragment;
  for (const dir of [link, real]) {
    for (const rule of [`Edit(/${dir})`, `Edit(/${dir}/**)`, `Read(/${dir})`, `Read(/${dir}/**)`]) assert.ok(f.permissions.deny.includes(rule), rule);
    assert.ok(f.sandbox.filesystem.denyWrite.includes(dir), `denyWrite ${dir}`);
    assert.ok(f.sandbox.filesystem.denyRead.includes(dir), `denyRead ${dir}`);
    assert.ok(f.sandbox.credentials.files.some((c) => c.path === dir), `credentials ${dir}`);
  }
  // The key really lands under the physical path the fragment now denies.
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `import { createDraftToken } from ${JSON.stringify(new URL("../../packages/missions/src/draft-token.js", import.meta.url).href)};
createDraftToken(process.argv[1], { title: "t", msn_id: "MSN-0101", skill_key: "gantry", gate_command: "npm test", interrogation: [], interrogation_sha256: "${"0".repeat(64)}", declared_paths: [] });`, dest], { cwd: getRepoRoot(), encoding: "utf8", env: { ...gitChildEnv(), GANTRY_STATE_DIR: link } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(real, "draft-token.json")), "the key is under the physical dir");
});

test("cage policy: a symlinked home adds the physical ~/.opengantry; nothing is added when nothing is linked", () => {
  const dest = makeRepo("og-cage-policy-homelink-");
  const realHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-policy-realhome-")));
  const linkHome = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-policy-linkhome-"))), "home");
  fs.symlinkSync(realHome, linkHome);
  const policyWithHome = (home: string): Fragment => {
    const r = cli(dest, ["--agent", "claude-code"], { HOME: home });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout) as Fragment;
  };
  const linked = policyWithHome(linkHome);
  const phys = `${realHome}/.opengantry`;
  assert.ok(linked.permissions.deny.includes(`Read(/${phys}/**)`) && linked.permissions.deny.includes(`Edit(/${phys})`));
  assert.ok(linked.sandbox.filesystem.denyRead.includes(phys) && linked.sandbox.filesystem.denyWrite.includes(phys));
  assert.ok(linked.sandbox.credentials.files.some((c) => c.path === phys));
  const plain = policyWithHome(realHome);
  assert.equal(JSON.stringify(plain).includes(realHome), false, "an unlinked home adds no absolute entries");
});

test("cage policy: every home secret is denied at its physical path too when HOME or the entry is a link (MSN-0385)", () => {
  const dest = makeRepo("og-cage-policy-homesecrets-");
  const realHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-policy-realhome2-")));
  const linkHome = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-policy-linkhome2-"))), "home");
  fs.symlinkSync(realHome, linkHome);
  const policy = (home: string): Fragment => {
    const r = cli(dest, ["--agent", "claude-code"], { HOME: home });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout) as Fragment;
  };
  // A linked HOME: each home secret also at /<real home>/<entry>, in Read, denyRead and credentials.
  const linked = policy(linkHome);
  for (const h of HOME) {
    const phys = `${realHome}/${h.slice(2)}`;
    assert.ok(linked.permissions.deny.includes(`Read(/${phys})`), `Read ${phys}`);
    assert.ok(linked.sandbox.filesystem.denyRead.includes(phys), `denyRead ${phys}`);
    assert.ok(linked.sandbox.credentials.files.some((c) => c.path === phys), `credentials ${phys}`);
    assert.ok(linked.permissions.deny.includes(`Read(${h})`), `the configured ${h} stays`);
  }
  // A home that is not a link, but ~/.ssh and ~/.kube are (stow, a dotfiles checkout): their physical targets are denied.
  const dotfiles = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-policy-dotfiles-")));
  fs.mkdirSync(path.join(dotfiles, "ssh"));
  fs.mkdirSync(path.join(dotfiles, "kube"));
  fs.symlinkSync(path.join(dotfiles, "ssh"), path.join(realHome, ".ssh"));
  fs.symlinkSync(path.join(dotfiles, "kube"), path.join(realHome, ".kube"));
  const stowed = policy(realHome);
  for (const phys of [`${dotfiles}/ssh`, `${dotfiles}/kube/config`]) {
    assert.ok(stowed.permissions.deny.includes(`Read(/${phys})`), `Read ${phys}`);
    assert.ok(stowed.sandbox.filesystem.denyRead.includes(phys), `denyRead ${phys}`);
    assert.ok(stowed.sandbox.credentials.files.some((c) => c.path === phys), `credentials ${phys}`);
  }
  assert.equal(JSON.stringify(stowed).includes(`${dotfiles}/aws`), false, "an entry that is not linked adds nothing");
  // Nothing linked: the pinned fragment, no absolute entries.
  const plainHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-policy-plainhome-")));
  assert.equal(JSON.stringify(policy(plainHome)).includes(plainHome), false);
});

test("cage policy: a dangling home-secret link is denied at its target too, where a write through it lands (PR #369 review round)", () => {
  const dest = makeRepo("og-cage-policy-dangling-");
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-policy-danglinghome-")));
  const dotfiles = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-policy-danglingdots-")));
  // ~/.ssh points at a directory that does not exist yet (an unmounted volume, a dotfiles checkout not cloned yet), and
  // ~/.aws is a relative link to a missing sibling of home.
  fs.symlinkSync(path.join(dotfiles, "ssh-not-yet"), path.join(home, ".ssh"));
  fs.symlinkSync("../aws-missing", path.join(home, ".aws"));
  const r = cli(dest, ["--agent", "claude-code"], { HOME: home });
  assert.equal(r.status, 0, r.stderr);
  const f = JSON.parse(r.stdout) as Fragment;
  for (const phys of [`${dotfiles}/ssh-not-yet`, `${path.dirname(home)}/aws-missing`]) {
    assert.ok(f.permissions.deny.includes(`Read(/${phys})`), `Read ${phys}`);
    assert.ok(f.sandbox.filesystem.denyRead.includes(phys), `denyRead ${phys}`);
    assert.ok(f.sandbox.credentials.files.some((c) => c.path === phys), `credentials ${phys}`);
  }
  assert.ok(f.permissions.deny.includes("Read(~/.ssh)"), "the configured ~/.ssh stays");
  // A dangling link loop never hangs the policy and adds no entry.
  const loop = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-policy-loophome-")));
  fs.symlinkSync(path.join(loop, ".kube"), path.join(loop, ".kube"));
  const l = cli(dest, ["--agent", "claude-code"], { HOME: loop });
  assert.equal(l.status, 0, l.stderr);
});

test("cage policy: a `..` after a linked component leaves the link's target, as the kernel resolves it (PR #369 review round 3)", () => {
  const dest = makeRepo("og-cage-policy-dotdot-");
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-policy-dotdothome-")));
  const dotfiles = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-policy-dotdotdots-")));
  fs.mkdirSync(path.join(dotfiles, "real", "sub"), { recursive: true });
  fs.symlinkSync(path.join(dotfiles, "real", "sub"), path.join(dotfiles, "alias"));
  // ~/.netrc -> <dotfiles>/alias/../netrc-missing: alias/.. is <dotfiles>/real, not <dotfiles>.
  fs.symlinkSync(`${dotfiles}/alias/../netrc-missing`, path.join(home, ".netrc"));
  const r = cli(dest, ["--agent", "claude-code"], { HOME: home });
  assert.equal(r.status, 0, r.stderr);
  const f = JSON.parse(r.stdout) as Fragment;
  const phys = `${dotfiles}/real/netrc-missing`;
  assert.ok(f.permissions.deny.includes(`Read(/${phys})`), `Read ${phys}: ${JSON.stringify(f.permissions.deny)}`);
  assert.ok(f.sandbox.filesystem.denyRead.includes(phys), `denyRead ${phys}`);
  assert.ok(f.sandbox.credentials.files.some((c) => c.path === phys), `credentials ${phys}`);
  assert.equal(JSON.stringify(f).includes(`${dotfiles}/netrc-missing`), false, "not the lexical path");
});

test("cage policy: the admission journal dir under the git dir is denied, in a linked worktree by its absolute path", () => {
  const main = makeRepo("og-cage-policy-wt-main-");
  const env = gitChildEnv();
  const git = (cwd: string, args: string[]): void => {
    const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", env });
    assert.equal(r.status, 0, r.stderr);
  };
  git(main, ["commit", "-q", "--allow-empty", "-m", "init"]);
  const wt = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-policy-wt-"))), "linked");
  git(main, ["worktree", "add", "-q", wt]);
  const f = JSON.parse(cageAgentPolicy(wt, "claude-code")) as Fragment;
  const journalDir = `${fs.realpathSync(main)}/.git/worktrees/linked/opengantry`;
  for (const rule of [`Edit(/${journalDir})`, `Edit(/${journalDir}/**)`, `Read(/${journalDir})`, `Read(/${journalDir}/**)`]) assert.ok(f.permissions.deny.includes(rule), rule);
  assert.ok(f.sandbox.filesystem.denyWrite.includes(journalDir) && f.sandbox.filesystem.denyRead.includes(journalDir));
  assert.equal(f.sandbox.credentials.files.some((c) => c.path === journalDir), false, "a journal is not a credential file");
  const plain = JSON.parse(cageAgentPolicy(main, "claude-code")) as Fragment;
  assert.equal(JSON.stringify(plain).includes("/worktrees/"), false, "a main checkout needs only ./.git/opengantry");
});
