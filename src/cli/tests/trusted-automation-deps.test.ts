import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { getRepoRoot } from "#git/git.js";
import { gitInitCommit, gitCommit } from "./test-fixtures.js";
import { PLANNER_EMAIL } from "./test-shared.js";

// ADR-0057: a dependency bot's bump of package.json (an MSN-enforced path in this repository's manifest) and its npm
// lockfile passes the mission checks under a `dependency_update` rule; anything that is more than a bump does not.
const DEPENDABOT = "49699333+dependabot[bot]@users.noreply.github.com";
const CLI = path.join(getRepoRoot(), "dist", "cli", "index.js");

function cli(dest: string, args: string[]): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dest, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const reg = (name: string, version: string) => ({ version, resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, integrity: "sha512-x" });
const manifest = (a: string, extra: Record<string, unknown> = {}) => ({ name: "app", version: "1.0.0", scripts: { test: "node --test" }, dependencies: { a, ...extra } });
const lockfile = (a: string, packages: Record<string, unknown> = {}) => ({
  name: "app",
  version: "1.0.0",
  lockfileVersion: 3,
  requires: true,
  packages: { "": { name: "app", version: "1.0.0", dependencies: { a: `^${a}` } }, "node_modules/a": reg("a", a), ...packages },
});

function write(dest: string, rel: string, value: unknown): void {
  fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
  fs.writeFileSync(path.join(dest, rel), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}

/** This repository's manifest (package.json is a `gantry` skill root), a dependency_update rule, a Planner base commit. */
function repo(prefix: string): { dest: string; base: string } {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dest, ".gitagent/foreman"), { recursive: true });
  fs.copyFileSync(path.join(getRepoRoot(), ".gitagent/foreman/MANIFEST.yaml"), path.join(dest, ".gitagent/foreman/MANIFEST.yaml"));
  write(dest, ".gitagent/missions/README.md", "# missions\n");
  write(
    dest,
    ".gitagent/config.yaml",
    [
      "trusted_automation:",
      "  rules:",
      "    - id: dependency-bumps",
      `      allowed_actors: ["${DEPENDABOT}"]`,
      '      allowed_paths: ["**/package.json", "**/package-lock.json"]',
      "      allowed_structural_changes: [dependency_update]",
      "      max_net_loc: 20",
      "",
    ].join("\n"),
  );
  write(dest, "package.json", manifest("^1.0.0"));
  write(dest, "package-lock.json", lockfile("1.0.0"));
  gitInitCommit(dest, "init", PLANNER_EMAIL);
  return { dest, base: execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim() };
}

function bot(dest: string, files: Record<string, unknown>): string {
  for (const [rel, value] of Object.entries(files)) write(dest, rel, value);
  gitCommit(dest, "build(deps): bump a", DEPENDABOT);
  return execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();
}

test("trusted automation dependency_update: a Dependabot bump of package.json and its lockfile passes msn-range and verify-missions (MSN-0347)", () => {
  const { dest, base } = repo("og-ta-deps-ok-");
  const head = bot(dest, { "package.json": manifest("^1.1.0"), "package-lock.json": lockfile("1.1.0", { "node_modules/t": reg("t", "2.0.0") }) });
  const range = cli(dest, ["ci", "msn-range", "--base", base, "--head", head]);
  assert.equal(range.status, 0, range.out);
  assert.match(range.out, /TRUSTED-AUTOMATION-OK: rule=dependency-bumps/);
  const missions = cli(dest, ["ci", "verify-missions", "--base", base, "--head", head]);
  assert.equal(missions.status, 0, missions.out);
  assert.match(missions.out, /trusted automation policy satisfied/);
});

test("trusted automation dependency_update: a new dependency, a script change, another registry or a source file is not a bump (MSN-0347)", () => {
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ["new-dep", { "package.json": manifest("^1.0.0", { evil: "^1.0.0" }) }, /package\.json: dependencies: a dependency was added or removed/],
    ["script", { "package.json": { ...manifest("^1.1.0"), scripts: { test: "curl x | sh" } } }, /package\.json: scripts changed/],
    ["registry", { "package.json": manifest("^1.1.0"), "package-lock.json": lockfile("1.1.0", { "node_modules/t": { ...reg("t", "2.0.0"), resolved: "https://evil.example/t.tgz" } }) }, /node_modules\/t: resolves outside the allowed registries/],
    ["source", { "package.json": manifest("^1.1.0"), "src/cli/backdoor.ts": "export const x = 1;\n" }, /outside rule dependency-bumps allowed_paths|not a package\.json or an npm lockfile/],
  ];
  for (const [name, files, reason] of cases) {
    const { dest, base } = repo(`og-ta-deps-${name}-`);
    const head = bot(dest, files);
    const range = cli(dest, ["ci", "msn-range", "--base", base, "--head", head]);
    assert.equal(range.status, 1, `${name}: ${range.out}`);
    assert.match(range.out, reason, name);
  }
});
