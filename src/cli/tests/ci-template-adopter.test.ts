import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

/**
 * 4.0.1: the CI workflow templates run in adopter repositories (gxt-validate.yml is installed by gantry init --ci and
 * gantry upgrade; docs/guides/ci.md says to copy gxt-attest-ingest.yml). They install @jeger-ai/opengantry from npm and
 * call only registered gantry commands; nothing of this repository's own build, scripts or examples.
 */

// Compiled to dist/cli/tests/, the repo root is three levels up. Import-free of src/cli/lib on purpose.
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const TEMPLATES = ["gxt-validate.yml", "gxt-attest-ingest.yml"] as const;
const REPO_INTERNAL = ["npm run build", "npm ci", "dist/cli", "scripts/npm-pack-check.sh", "scripts/check-changed-code.sh", "examples/iii-integration"];
const INSTALL = /npm install -g @jeger-ai\/opengantry@|npx -y -p @jeger-ai\/opengantry@/;

interface Step {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
}

function read(file: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, "templates", ".github", "workflows", file), "utf8");
}

function jobs(file: string): Record<string, { steps: Step[] }> {
  return (YAML.parse(read(file)) as { jobs: Record<string, { steps: Step[] }> }).jobs;
}

function registeredCommands(): Set<string> {
  const doc = YAML.parse(fs.readFileSync(path.join(REPO_ROOT, ".gitagent", "registry", "commands.yaml"), "utf8")) as { entries: { name: string }[] };
  return new Set(doc.entries.map((e) => e.name));
}

/** Every `gantry <word> [<word>]` in a run script, comment lines dropped. */
function invocations(run: string): string[][] {
  const code = run
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");
  return [...code.matchAll(/(?<![\w@/-])gantry\s+([a-z][a-z-]*)(?:\s+([a-z][a-z-]*))?/g)].map((m) => [m[1]!, ...(m[2] ? [m[2]] : [])]);
}

/** The registered command an invocation names: a group with subcommands needs one of them. */
function resolve(words: string[], registered: Set<string>): string | undefined {
  const [first, second] = words;
  const isGroup = [...registered].some((n) => n.startsWith(`${first!} `));
  if (isGroup) return second && registered.has(`${first!} ${second}`) ? `${first!} ${second}` : undefined;
  return registered.has(first!) ? first : undefined;
}

test("ci template: no repository-internal build, script or example path", () => {
  for (const file of TEMPLATES) {
    const text = read(file);
    for (const needle of REPO_INTERNAL) assert.ok(!text.includes(needle), `${file} references ${needle}`);
  }
});

test("ci template: every job that runs gantry installs @jeger-ai/opengantry from npm first, and setup-node needs no lockfile", () => {
  let jobsWithGantry = 0;
  for (const file of TEMPLATES) {
    for (const [job, def] of Object.entries(jobs(file))) {
      const install = def.steps.findIndex((s) => INSTALL.test(s.run ?? ""));
      const first = def.steps.findIndex((s) => invocations(s.run ?? "").length > 0);
      for (const step of def.steps.filter((s) => s.uses?.startsWith("actions/setup-node@"))) {
        assert.equal(step.with?.cache, undefined, `${file} ${job}: setup-node cache needs a lockfile`);
        assert.equal(step.with?.["package-manager-cache"], false, `${file} ${job}: setup-node must not turn on npm caching (packageManager: npm without a lockfile fails)`);
      }
      if (first < 0) continue;
      jobsWithGantry += 1;
      assert.ok(install >= 0 && install < first, `${file} ${job} installs the CLI before calling gantry`);
    }
  }
  assert.equal(jobsWithGantry, 4, "manifest, msn_commits, mission_verify, attest_ingest");
});

test("ci template: every gantry invocation is a command in .gitagent/registry/commands.yaml", () => {
  const registered = registeredCommands();
  const seen = new Set<string>();
  for (const file of TEMPLATES) {
    for (const [job, def] of Object.entries(jobs(file))) {
      for (const step of def.steps) {
        for (const words of invocations(step.run ?? "")) {
          const name = resolve(words, registered);
          assert.ok(name, `${file} ${job}: gantry ${words.join(" ")} is not a registered command`);
          seen.add(name);
        }
      }
    }
  }
  assert.deepEqual(
    [...seen].sort(),
    ["ci msn-range", "ci verify-missions", "deps fetch", "doctor", "ledger append", "mission changed", "perimeter", "verify"],
  );
});

test("ci template: gxt-validate keeps the job names branch protection relies on", () => {
  assert.deepEqual(Object.keys(jobs("gxt-validate.yml")), ["pr_governance", "manifest", "msn_commits", "mission_verify"]);
});
