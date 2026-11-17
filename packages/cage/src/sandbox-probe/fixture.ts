import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gitRun } from "#git/git.js";

/**
 * A disposable canary fixture (MSN-0391): a fake home with planted secrets, a state dir, a git repository with an
 * admission journal, protected paths and a contract forbidden path, and an outside dir for escape markers. Secrets are
 * random tokens, never real credentials. One fixture per canary, so no canary sees another's damage.
 */

export interface Fixture {
  base: string;
  home: string;
  repo: string;
  out: string;
  tmp: string;
  outside: string;
  stateEnv: string;
  /** Token per planted secret, keyed by name; a read canary passes when no token reaches `out/`. */
  secrets: { ssh: string; state: string; stateEnv: string; journal: string; env: string; launchEnv: string; ghToken: string; githubToken: string };
  paths: { ssh: string; state: string; stateEnvFile: string; journal: string; env: string; gitConfig: string; hooks: string; forbidden: string; workflow: string };
  /** The packed postinstall canary package, when one was made for this fixture. */
  npmTarball: string | null;
  /** The admission policy a broker for this fixture reads (outside the work tree, under the state dir). */
  brokerPolicy: string;
}

const token = (name: string): string => `OGCANARY-${name}-${crypto.randomBytes(12).toString("hex")}`;

function write(p: string, text: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

function git(cwd: string, args: string[]): void {
  const r = gitRun(cwd, args, { env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
  if (!r.ok) throw new Error(`canary fixture: git ${args[0]} failed: ${r.stderr.trim()}`);
}

/** The postinstall canary: reads the home secret into out/, writes .git/hooks and ~/.opengantry, marks that it ran. */
function packNpmCanary(fx: Omit<Fixture, "npmTarball" | "brokerPolicy">): string {
  const pkg = path.join(fx.base, "npm-canary-src");
  write(path.join(pkg, "package.json"), JSON.stringify({ name: "og-npm-canary", version: "1.0.0", scripts: { postinstall: "node postinstall.js" } }));
  const script = [
    "const fs = require('fs');",
    `fs.writeFileSync(${JSON.stringify(path.join(fx.out, "npm-ran.txt"))}, 'ran');`,
    `try { fs.writeFileSync(${JSON.stringify(path.join(fx.out, "npm-read.txt"))}, fs.readFileSync(${JSON.stringify(fx.paths.ssh)})); } catch {}`,
    `try { fs.writeFileSync(${JSON.stringify(path.join(fx.paths.hooks, "post-npm"))}, 'x'); } catch {}`,
    `try { fs.writeFileSync(${JSON.stringify(path.join(fx.home, ".opengantry", "npm"))}, 'x'); } catch {}`,
  ].join("\n");
  write(path.join(pkg, "postinstall.js"), `${script}\n`);
  const r = spawnSync("npm", ["pack", "--silent", "--pack-destination", fx.base], { cwd: pkg, encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: fx.base, npm_config_cache: path.join(fx.base, "npm-pack-cache") } });
  if (r.status !== 0) throw new Error(`canary fixture: npm pack failed: ${r.stderr.trim()}`);
  const tgz = path.join(fx.base, r.stdout.trim().split("\n").pop()!);
  write(path.join(fx.repo, "app", "package.json"), JSON.stringify({ name: "og-npm-app", version: "1.0.0", private: true, dependencies: { "og-npm-canary": `file:${tgz}` } }));
  return tgz;
}

export function makeFixture(opts: { npm: boolean; broker?: boolean }): Fixture {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-canary-")));
  const home = path.join(base, "home");
  const repo = path.join(base, "repo");
  const stateEnv = path.join(base, "state-env");
  const secrets = {
    ssh: token("ssh"),
    state: token("state"),
    stateEnv: token("stateenv"),
    journal: token("journal"),
    env: token("env"),
    // Planted in the launch environment of the env canary only (OGCANARY_GH_TOKEN, GH_TOKEN, GITHUB_TOKEN).
    launchEnv: token("launchenv"),
    ghToken: token("ghtoken"),
    githubToken: token("githubtoken"),
  };
  const paths = {
    ssh: path.join(home, ".ssh", "id_ed25519"),
    state: path.join(home, ".opengantry", "draft-token.key"),
    stateEnvFile: path.join(stateEnv, "draft-token.key"),
    journal: path.join(repo, ".git", "opengantry", "admission", "journal.jsonl"),
    env: path.join(repo, ".env"),
    gitConfig: path.join(repo, ".git", "config"),
    hooks: path.join(repo, ".git", "hooks"),
    forbidden: path.join(repo, "secret-zone", "law.txt"),
    workflow: path.join(repo, ".github", "workflows", "ci.yml"),
  };
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.name", "OpenGantry Canary"]);
  git(repo, ["config", "user.email", "canary@example.invalid"]);
  write(paths.ssh, `${secrets.ssh}\n`);
  write(paths.state, `${secrets.state}\n`);
  write(paths.stateEnvFile, `${secrets.stateEnv}\n`);
  // A broker refuses a journal someone else wrote, so a broker fixture leaves the journal to the broker.
  if (!opts.broker) write(paths.journal, `${secrets.journal}\n`);
  write(paths.env, `TOKEN=${secrets.env}\n`);
  write(paths.forbidden, "law\n");
  write(paths.workflow, "on: push\n");
  write(path.join(repo, "README.txt"), "readable\n");
  write(path.join(repo, "verify.yaml"), 'schema: opengantry.verify.v1\nscope:\n  forbidden_paths: ["secret-zone/"]\n');
  const fx = { base, home, repo, out: path.join(repo, "out"), tmp: path.join(base, "tmp"), outside: path.join(base, "outside"), stateEnv, secrets, paths };
  for (const d of [fx.out, fx.tmp, fx.outside]) fs.mkdirSync(d, { recursive: true });
  const brokerPolicy = path.join(home, ".opengantry", "admission", "policy.json");
  if (opts.broker) {
    write(brokerPolicy, `${JSON.stringify({ schema: "opengantry.admission-policy.v1", requirements: {}, rules: [], advisoryRules: [] })}\n`);
    for (const d of [path.join(home, ".opengantry"), path.dirname(brokerPolicy)]) fs.chmodSync(d, 0o700);
    fs.chmodSync(brokerPolicy, 0o600);
  }
  return { ...fx, npmTarball: opts.npm ? packNpmCanary(fx) : null, brokerPolicy };
}

export function removeFixture(fx: Fixture): void {
  fs.rmSync(fx.base, { recursive: true, force: true });
}

/** sha256 of a file, "dir", "link:<target>" or "absent"; never follows a link. */
export function fileState(p: string): string {
  try {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) return `link:${fs.readlinkSync(p)}`;
    if (st.isDirectory()) return "dir";
    return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  } catch {
    return "absent";
  }
}

/** Does any file under `out/` hold one of the fixture's secret tokens? Names the secret, never its value. */
export function leakedSecrets(fx: Fixture): string[] {
  const leaked = new Set<string>();
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        const text = fs.readFileSync(p, "utf8");
        for (const [name, value] of Object.entries(fx.secrets)) if (text.includes(value)) leaked.add(name);
      }
    }
  };
  walk(fx.out);
  return [...leaked].sort();
}
