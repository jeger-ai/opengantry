// Conformance fixtures (ADR-0052 step 1, MSN-0281): small git repositories the golden cases run in.
// Each builder writes one repository under <outDir>/<name>. Content is deterministic: fixed emails,
// fixed dates, fixed file bodies, no timestamps of the build machine. Builders call the built CLI
// (dist/cli/index.js) only where the fixture is "what gantry init leaves behind".
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const PLANNER_EMAIL = "planner@fixture.test";
export const FIXTURE_NAMES = [
  "bare-git",
  "fresh-init",
  "mission-pass",
  "mission-fail-gate",
  "mission-stale",
  "cage-tamper",
  "contract-standalone",
];

const FIXED_DATE = "2026-01-01T00:00:00Z";

/** Environment for git inside fixtures: fixed identity and dates, no inherited repository location. */
export function gitEnv(extra = {}) {
  // Built from scratch: nothing inherited from the caller except PATH and HOME, so no GIT_*, GANTRY_*,
  // GXT_* or GAPMAN_* variable of the developer's shell reaches a fixture.
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: "C",
    TZ: "UTC",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: PLANNER_EMAIL,
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: PLANNER_EMAIL,
    GIT_AUTHOR_DATE: FIXED_DATE,
    GIT_COMMITTER_DATE: FIXED_DATE,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    ...extra,
  };
}

function git(cwd, args, env = {}) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: gitEnv(env) });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} in ${cwd}: ${r.stderr}`);
  return r.stdout;
}

function write(root, rel, body) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

function gitInit(root, email = PLANNER_EMAIL) {
  fs.mkdirSync(root, { recursive: true });
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", email]);
  git(root, ["config", "user.name", "Fixture"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  git(root, ["config", "core.hooksPath", ".githooks"]);
}

function commitAll(root, subject, email = PLANNER_EMAIL) {
  git(root, ["add", "-A", "--"]);
  git(root, ["commit", "-q", "-m", subject], { GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_EMAIL: email });
}

function runCli(cli, root, args) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: gitEnv({ GANTRY_PLANNER_EMAILS: PLANNER_EMAIL, NO_COLOR: "1" }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.status !== 0) throw new Error(`gantry ${args.join(" ")} in ${root} exited ${r.status}: ${r.stderr}`);
  return r.stdout;
}

/** A git repository with one commit and no OpenGantry substrate. For init, onboarding, cage without a manifest. */
export function buildBareGit(root) {
  gitInit(root);
  write(root, "README.md", "# fixture\n");
  write(root, "src/app.ts", "export const app = 1;\n");
  commitAll(root, "initial");
}

/** What `gantry init --yes` leaves behind, committed as the substrate commit. */
export function buildFreshInit(root, cli) {
  buildBareGit(root);
  runCli(cli, root, ["init", "--yes", "--no-hooks", "--no-ci", "--skills", "minimal", "--no-defensive-profile", "--ides", "cursor"]);
  commitAll(root, "[MSN-0001] gantry init --yes");
}

const MINI_MANIFEST = {
  schema_version: "0.5.0",
  skills: {
    ui: {
      desc: "UI components (fixture).",
      trust_threshold: "Tier-1",
      tmvc_roots: ["src/components/"],
      forbidden_zones: [".gitagent/foreman/"],
      gate_commands: ["echo DONE", "sh -c 'echo NOPE; exit 1'"],
    },
  },
  path_risks: { ".gitagent/": "Tier-3" },
  risk_keywords: ["migrate", "delete"],
  perimeter_protected: [".gitagent/foreman/MANIFEST.json"],
};

function writeMission(root, msn, gateCommand, gateSubstring, traceQuote) {
  const rel = `.gitagent/missions/m-${msn}.yaml`;
  const quote = traceQuote.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  write(
    root,
    rel,
    `# Fixture mission (conformance suite).
msn_id: ${msn}
skill_key: ui
gate_command: ${JSON.stringify(gateCommand)}
gate_success_substring: ${JSON.stringify(gateSubstring)}
trace_rows:
  - dod_id: "1"
    trace_quote: "${quote}"
    anchor: "1"
    status: PASS
`,
  );
  write(root, "EXECUTOR_LOG.md", `${traceQuote}\n`);
  return rel;
}

/** fresh-init plus a one-skill manifest and a stamped mission whose gate passes. */
export function buildMissionPass(root, cli, opts = {}) {
  buildFreshInit(root, cli);
  write(root, ".gitagent/foreman/MANIFEST.json", `${JSON.stringify(MINI_MANIFEST, null, 2)}\n`);
  for (const f of fs.readdirSync(path.join(root, "skills"))) {
    if (f !== "ui.md") fs.rmSync(path.join(root, "skills", f));
  }
  write(root, "src/components/Button.ts", "export const Button = () => 'button';\n");
  const gate = opts.gate ?? "echo DONE";
  const substring = opts.substring ?? "DONE";
  writeMission(root, "MSN-0101", gate, substring, "evidence A: gate echoed DONE");
  commitAll(root, "[MSN-0101] Legislate the fixture mission (ui skill, gate echo DONE)");
}

/** Same as mission-pass, with a gate that exits 1. */
export function buildMissionFailGate(root, cli) {
  buildMissionPass(root, cli, { gate: "sh -c 'echo NOPE; exit 1'", substring: "DONE" });
}

/** mission-pass, then a later commit under the skill's TMVC root so committed PASS evidence is stale. */
export function buildMissionStale(root, cli) {
  buildMissionPass(root, cli);
  write(root, "src/components/Button.ts", "export const Button = () => 'button v2';\n");
  commitAll(root, "[MSN-0101] Change the component after attestation", "executor@fixture.test");
}

/** A repository whose later commits change paths the cage protects. */
export function buildCageTamper(root) {
  gitInit(root);
  write(root, "README.md", "# cage fixture\n");
  write(root, ".github/workflows/ci.yml", "on: push\njobs: {}\n");
  write(root, ".env", "SECRET=one\n");
  write(root, ".githooks/pre-commit", "#!/bin/sh\nexit 0\n");
  write(root, "package-lock.json", '{"name":"fixture","lockfileVersion":3}\n');
  write(root, "src/app.ts", "export const app = 1;\n");
  commitAll(root, "initial");
  write(root, ".env", "SECRET=two\n");
  commitAll(root, "agent: edit .env", "agent@fixture.test");
  write(root, ".github/workflows/ci.yml", "on: push\njobs: {deploy: {runs-on: ubuntu-latest, steps: []}}\n");
  write(root, "package-lock.json", '{"name":"fixture","lockfileVersion":3,"packages":{}}\n');
  write(root, "src/app.ts", "export const app = 2;\n");
  commitAll(root, "agent: edit workflow, lockfile and app", "agent@fixture.test");
}

/** A repository with a standalone verify contract and no .gitagent/. Cases are skipped until MSN-0277 lands. */
export function buildContractStandalone(root) {
  gitInit(root);
  write(root, "README.md", "# contract fixture\n");
  write(root, "src/app.ts", "export const app = 1;\n");
  write(
    root,
    "verify.yaml",
    `schema: opengantry.verify.v1
scope:
  allowed_paths: ["src/", "README.md"]
  forbidden_paths: [".github/"]
size:
  max_added_lines: 200
rules:
  - name: no-console
    files: ["src/**/*.ts"]
    forbid: "console\\\\.log\\\\("
    why: no debug output in src
checks:
  - name: unit
    run: "echo ok"
    expect: exit0
`,
  );
  write(
    root,
    "gate.json",
    `${JSON.stringify(
      {
        schema: "commitly.gate.v1",
        allowed_paths: ["src/", "README.md"],
        forbidden_paths: [".github/"],
        max_added_lines: 200,
        rules: [{ name: "no-console", approach: "no debug output in src", files: ["src/**/*.ts"], forbid: "console\\.log\\(" }],
        checks: [{ name: "unit", cmd: "echo ok", expect: "exit0" }],
      },
      null,
      2,
    )}\n`,
  );
  commitAll(root, "initial");
  write(root, "src/app.ts", "export const app = 2;\n");
  commitAll(root, "change under scope", "agent@fixture.test");
}

export function buildFixture(name, root, cli) {
  switch (name) {
    case "bare-git":
      return buildBareGit(root);
    case "fresh-init":
      return buildFreshInit(root, cli);
    case "mission-pass":
      return buildMissionPass(root, cli);
    case "mission-fail-gate":
      return buildMissionFailGate(root, cli);
    case "mission-stale":
      return buildMissionStale(root, cli);
    case "cage-tamper":
      return buildCageTamper(root);
    case "contract-standalone":
      return buildContractStandalone(root);
    default:
      throw new Error(`unknown fixture ${name}`);
  }
}

export function buildAll(outDir, cli) {
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const name of FIXTURE_NAMES) buildFixture(name, path.join(outDir, name), cli);
  return FIXTURE_NAMES.map((name) => path.join(outDir, name));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2];
  const cli = process.argv[3];
  if (!outDir || !cli) {
    console.error("usage: node build-fixtures.mjs <outDir> <path to dist/cli/index.js>");
    process.exit(2);
  }
  for (const p of buildAll(path.resolve(outDir), path.resolve(cli))) console.log(p);
}
