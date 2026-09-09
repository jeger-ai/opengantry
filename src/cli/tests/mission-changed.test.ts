import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { GIT_CONFIG_ALLOWED_SIGNERS, REL_PLANNER_SIGNING_PUB } from "../lib/constants.js";
import { getRepoRoot, gitConfigGet } from "../lib/git.js";
import { discoverChangedMissions } from "../lib/mission-changed.js";
import { ensurePlannerAllowedSignersFile } from "../lib/planner-signature.js";
import { gitCommit, gitInitCommit, writeManifest } from "./test-fixtures.js";
import { PLANNER_EMAIL } from "./test-shared.js";

function writeMissionYaml(dest: string, msn: string, slug: string): string {
  const rel = `.gitagent/missions/${msn}.${slug}.yaml`;
  fs.mkdirSync(path.join(dest, ".gitagent/missions"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, rel),
    `msn_id: ${msn}\nskill_key: gantry\ngate_command: echo OK\ngate_success_substring: OK\ntrace_rows: []\n`,
    "utf8",
  );
  return rel;
}

test("discoverChangedMissions: contamination when range has two MSN tags", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-mission-changed-contam-"));
  fs.writeFileSync(path.join(dest, "README.md"), "init\n", "utf8");
  gitInitCommit(dest, "init", PLANNER_EMAIL);
  const baseSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();
  fs.writeFileSync(path.join(dest, "a.txt"), "1\n", "utf8");
  gitCommit(dest, "[MSN-0022] first", PLANNER_EMAIL);
  fs.writeFileSync(path.join(dest, "b.txt"), "2\n", "utf8");
  gitCommit(dest, "[MSN-0023] second", PLANNER_EMAIL);
  const result = discoverChangedMissions(dest, { baseRef: baseSha });
  assert.equal(result.kind, "contamination");
  if (result.kind === "contamination") {
    assert.deepEqual(result.uniqueMsns, ["MSN-0022", "MSN-0023"]);
  }
});

test("discoverChangedMissions: repeated same MSN is ok with empty mission list", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-mission-changed-same-"));
  fs.writeFileSync(path.join(dest, "README.md"), "init\n", "utf8");
  gitInitCommit(dest, "init", PLANNER_EMAIL);
  const baseSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();
  fs.writeFileSync(path.join(dest, "README.md"), "one\n", "utf8");
  gitCommit(dest, "[MSN-0025] one", PLANNER_EMAIL);
  fs.writeFileSync(path.join(dest, "README.md"), "two\n", "utf8");
  gitCommit(dest, "[MSN-0025] two", PLANNER_EMAIL);
  const result = discoverChangedMissions(dest, { baseRef: baseSha });
  assert.equal(result.kind, "ok");
  if (result.kind === "ok") {
    assert.equal(result.purityMsn, "MSN-0025");
    assert.deepEqual(result.missions, []);
  }
});

test("discoverChangedMissions: purity mismatch when basename does not match commit MSN", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-mission-changed-mismatch-"));
  fs.writeFileSync(path.join(dest, "README.md"), "init\n", "utf8");
  gitInitCommit(dest, "init", PLANNER_EMAIL);
  const baseSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();
  writeMissionYaml(dest, "MSN-0022", "wrong-mission");
  gitCommit(dest, "[MSN-0025] legislate mismatched mission file", PLANNER_EMAIL);
  const result = discoverChangedMissions(dest, { baseRef: baseSha });
  assert.equal(result.kind, "purity_mismatch");
  if (result.kind === "purity_mismatch") {
    assert.equal(result.purityMsn, "MSN-0025");
  }
});

test("discoverChangedMissions: release-squash keeps only the purity MSN file", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-mission-changed-squash-"));
  fs.writeFileSync(path.join(dest, "README.md"), "init\n", "utf8");
  gitInitCommit(dest, "init", PLANNER_EMAIL);
  const baseSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();
  const keep = writeMissionYaml(dest, "MSN-0027", "keep");
  writeMissionYaml(dest, "MSN-0001", "companion");
  gitCommit(dest, "[MSN-0027] squash with companion mission file", PLANNER_EMAIL);
  const result = discoverChangedMissions(dest, { baseRef: baseSha });
  assert.equal(result.kind, "ok");
  if (result.kind === "ok") {
    assert.deepEqual(result.missions, [keep]);
    assert.equal(result.companionCount, 1);
    assert.equal(result.purityMsn, "MSN-0027");
  }
});

test("gantry mission changed --json: ok payload lists purity-filtered missions", () => {
  const ogRoot = getRepoRoot();
  const cli = path.join(ogRoot, "dist/cli/index.js");
  if (!fs.existsSync(cli)) return;
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-mission-changed-cli-"));
  fs.writeFileSync(path.join(dest, "README.md"), "init\n", "utf8");
  writeManifest(dest, {
    gantry: { trust_threshold: "Tier-2", tmvc_roots: ["src/"], forbidden_zones: [] },
  });
  gitInitCommit(dest, "init", PLANNER_EMAIL);
  const baseSha = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();
  const keep = writeMissionYaml(dest, "MSN-0028", "cli");
  gitCommit(dest, "[MSN-0028] cli json", PLANNER_EMAIL);
  const run = spawnSync("node", [cli, "mission", "changed", "--base-ref", baseSha, "--json"], {
    cwd: dest,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, (run.stderr || "") + (run.stdout || ""));
  const payload = JSON.parse(run.stdout) as { status: string; missions: string[]; purity_msn: string };
  assert.equal(payload.status, "ok");
  assert.deepEqual(payload.missions, [keep]);
  assert.equal(payload.purity_msn, "MSN-0028");
});

test("ensurePlannerAllowedSignersFile: sets gpg.ssh.allowedSignersFile when pub is present", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-allowed-signers-"));
  fs.writeFileSync(path.join(dest, "README.md"), "init\n", "utf8");
  gitInitCommit(dest, "init", PLANNER_EMAIL);
  const missing = ensurePlannerAllowedSignersFile(dest);
  assert.equal(missing.present, false);
  fs.mkdirSync(path.join(dest, ".gitagent/foreman"), { recursive: true });
  fs.writeFileSync(path.join(dest, REL_PLANNER_SIGNING_PUB), "planner@test.local ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFake\n", "utf8");
  const set = ensurePlannerAllowedSignersFile(dest);
  assert.equal(set.present, true);
  assert.equal(set.configured, true);
  assert.equal(set.path, REL_PLANNER_SIGNING_PUB);
  assert.equal(gitConfigGet(dest, GIT_CONFIG_ALLOWED_SIGNERS), REL_PLANNER_SIGNING_PUB);
});
