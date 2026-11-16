import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gitChildEnv } from "#git/git.js";
import { loadVerifyContract, mergeRepositoryLaw, parseVerifyContract, parseVerifyYaml } from "#verify/contract.js";

const SECTION = [
  "dependencies:",
  "  schema: opengantry.dependency-policy.v1",
  "  mode: enforce",
  "  ecosystems:",
  "    npm:",
  "      lockfile_versions: [2, 3]",
  '      npm_version: "11.6.2"',
  "  registries:",
  "    - https://registry.npmjs.org/",
  "  lifecycle:",
  "    default: deny",
  "",
].join("\n");

const yaml = (section = SECTION) => `schema: opengantry.verify.v1\n${section}`;

function invalid(text: string, detail: RegExp): void {
  assert.throws(
    () => parseVerifyYaml(text),
    (e: unknown) => (e as { code?: string }).code === "GXT_VERIFY_CONTRACT_INVALID" && detail.test((e as Error).message),
  );
}

test("verify contract: the dependencies section is read into the contract (MSN-0382)", () => {
  const c = parseVerifyYaml(yaml());
  assert.equal(c.dependencies?.schema, "opengantry.dependency-policy.v1");
  assert.equal(c.dependencies?.mode, "enforce");
  assert.deepEqual(c.dependencies?.registries, ["https://registry.npmjs.org/"]);
  assert.equal(parseVerifyYaml("schema: opengantry.verify.v1\n").dependencies, null, "no section, no policy");
});

test("verify contract: the dependencies section is closed and strict (MSN-0382)", () => {
  invalid(yaml(SECTION.replace("  mode: enforce\n", "  mode: enforce\n  allow_all: true\n")), /dependencies: unknown key "allow_all"/);
  invalid(yaml(SECTION.replace("mode: enforce", "mode: [enforce]")), /dependencies\.mode must be audit or enforce/);
  invalid(yaml(SECTION.replace("opengantry.dependency-policy.v1", "opengantry.dependency-policy.v2")), /dependencies\.schema must be opengantry\.dependency-policy\.v1/);
  invalid(yaml(SECTION.replace("    - https://registry.npmjs.org/", "    - https://registry.npmjs.org/\n    - https://registry.npmjs.org/\n  registries: []")), /duplicate|unique/i);
  invalid(yaml(`${SECTION}  approval_refs: &refs [a/]\n  sources: *refs\n`), /alias/i);
  invalid(yaml("dependencies: enforce\n"), /verify contract: dependencies must be a mapping/);
});

test("verify contract: a gate.json task contract cannot carry its own dependencies section (MSN-0382)", () => {
  const gate = JSON.stringify({ schema: "opengantry.gate.v1", dependencies: { schema: "opengantry.dependency-policy.v1" } });
  assert.throws(() => parseVerifyContract(gate, "gate.json"), /unknown key "dependencies"/);
});

test("verify contract: a task contract inherits the repository dependencies section tighten-only (MSN-0382)", () => {
  const repo = parseVerifyYaml(yaml(SECTION.replace("mode: enforce", "mode: audit").replace("default: deny", "default: allow-approved")));
  const none = parseVerifyYaml("schema: opengantry.verify.v1\n");
  assert.deepEqual(mergeRepositoryLaw(none, repo).dependencies, repo.dependencies, "a task without the section inherits it");
  const task = parseVerifyYaml(yaml(SECTION.replace("    - https://registry.npmjs.org/", "    - https://registry.npmjs.org/\n    - https://npm.corp.example/")));
  const merged = mergeRepositoryLaw(task, repo).dependencies!;
  assert.equal(merged.mode, "enforce");
  assert.equal(merged.lifecycle, "deny");
  assert.deepEqual(merged.registries, ["https://registry.npmjs.org/"], "the task cannot add a registry");
  const otherPin = parseVerifyYaml(yaml(SECTION.replace('"11.6.2"', '"11.7.0"')));
  assert.throws(() => mergeRepositoryLaw(otherPin, repo), /GXT_VERIFY_CONTRACT_INVALID|npm_version differs from the floor/);
});

function git(dest: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", dest, "-c", "user.email=fixture@example.com", "-c", "user.name=Fixture", "-c", "commit.gpgsign=false", ...args], {
    encoding: "utf8",
    env: gitChildEnv(),
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

test("verify contract: a task contract cannot add a baseline the repository section does not name (MSN-0382)", () => {
  const repo = parseVerifyYaml(yaml(SECTION));
  const task = parseVerifyYaml(yaml(SECTION.replace("  mode: enforce\n", `  mode: enforce\n  approved_baseline_digest: ${"a".repeat(64)}\n`)));
  assert.equal(task.dependencies?.approvedBaselineDigest, "a".repeat(64));
  assert.throws(() => mergeRepositoryLaw(task, repo), (e: unknown) => (e as { code?: string }).code === "GXT_VERIFY_CONTRACT_INVALID" && /cannot add one/.test((e as Error).message));
});

test("verify contract: a candidate change to its own dependencies section is judged by the base version (MSN-0382)", () => {
  const dest = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-deps-")));
  try {
    git(dest, "init", "-q", "-b", "main");
    fs.writeFileSync(path.join(dest, "verify.yaml"), yaml());
    git(dest, "add", "-A");
    git(dest, "commit", "-q", "-m", "base");
    const base = git(dest, "rev-parse", "HEAD");
    fs.writeFileSync(path.join(dest, "verify.yaml"), yaml(SECTION.replace("mode: enforce", "mode: audit").replace("default: deny", "default: allow-approved")));
    git(dest, "commit", "-q", "-am", "candidate loosens its own dependency policy");
    const { loaded } = loadVerifyContract(dest, "verify.yaml", () => base);
    assert.equal(loaded.source, "base");
    assert.equal(loaded.contract.dependencies?.mode, "enforce");
    assert.equal(loaded.contract.dependencies?.lifecycle, "deny");
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test("verify contract: the guide's dependencies example is a valid, closed section (MSN-0382)", () => {
  const guide = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/guides/verify-contract.md"), "utf8");
  const block = /```yaml\n(# A POST-CHANGE CHECK, NOT PREVENTION[\s\S]*?)```/.exec(guide);
  assert.ok(block, "the guide has the dependencies example, labelled as a post-change check, not prevention (MSN-0383)");
  const c = parseVerifyYaml(`schema: opengantry.verify.v1\n${block[1]!}`);
  assert.equal(c.dependencies?.mode, "audit");
  assert.equal(c.dependencies?.lifecycle, "deny");
});
