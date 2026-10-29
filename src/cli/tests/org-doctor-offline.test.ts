import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRepoRoot } from "#git/git.js";
import { runPolicyDiff } from "../commands/policy.js";
import { collectDoctorReport } from "../doctor/doctor-core.js";
import { computeWorkingDigests } from "#plane/digests.js";
import { loadManifest } from "#missions/manifest.js";
import { gitInitCommit, writeMiniGantryRepo } from "./test-fixtures.js";
import { captureConsole, PLANNER_EMAIL } from "./test-shared.js";
import { writeOrgPolicyRepo } from "./test-org-fixtures.js";

test("doctor and policy digest sources never clone or fetch", () => {
  const root = path.join(getRepoRoot(), "src/cli/doctor");
  const plane = path.join(getRepoRoot(), "packages/plane/src");
  const files = [
    path.join(plane, "digests.ts"),
    path.join(getRepoRoot(), "packages/missions/src/gxt-config.ts"),
    path.join(plane, "policy-resolve.ts"),
    path.join(plane, "ledger-chain.ts"),
    path.join(root, "doctor-core.ts"),
  ];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(src, /pullOrgPolicy|fetchMissionDependency/);
    assert.doesNotMatch(src, /git clone|git fetch/);
    assert.doesNotMatch(src, /from "\.\/policy\/policy-fetch/);
    assert.doesNotMatch(src, /from "\.\/deps\/deps-fetch/);
  }
});

function policyDiff(expectedManifestSha: (dest: string) => string): { status: number; stdout: string } {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-policy-diff-"));
  writeMiniGantryRepo(dest, getRepoRoot());
  writeOrgPolicyRepo(dest, getRepoRoot(), `expected_digests:\n  manifest_sha256: "${expectedManifestSha(dest)}"\n`);
  gitInitCommit(dest, "chore: init", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  process.chdir(dest);
  process.exitCode = undefined;
  try {
    const { output } = captureConsole(() => runPolicyDiff({ json: true }));
    return { status: Number(process.exitCode ?? 0), stdout: output.stdout };
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
  }
}

test("policy diff: the org bundle's expected_digests must match the working tree, else GXT_POLICY_DRIFT exit 1", () => {
  const ok = policyDiff((dest) => computeWorkingDigests(dest).manifest_sha256 ?? "");
  assert.equal(ok.status, 0, ok.stdout);
  assert.equal((JSON.parse(ok.stdout) as { status: string }).status, "ok");

  const drift = policyDiff(() => "0".repeat(64));
  assert.equal(drift.status, 1, drift.stdout);
  const envelope = JSON.parse(drift.stdout) as { status: string; error_code: string; message: string };
  assert.equal(envelope.status, "failed");
  assert.equal(envelope.error_code, "GXT_POLICY_DRIFT");
  assert.match(envelope.message, /policy digest manifest_sha256: drift \(expected 0{64}, actual [a-f0-9]{64}\)/);
});

test("doctor: a local config that still sets receipt_signature warns that it was removed and is ignored (ADR-0061)", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-doctor-receipt-tier-"));
  writeMiniGantryRepo(dest, getRepoRoot());
  gitInitCommit(dest, "chore: init", PLANNER_EMAIL);
  const removed = (): boolean => collectDoctorReport(dest, loadManifest(dest)).lines.some((l) => l.level === "warn" && /receipt_signature was removed in 4\.0/.test(l.message));
  assert.equal(removed(), false);
  fs.writeFileSync(path.join(dest, ".gitagent", "config.yaml"), "receipt_signature: require\n", "utf8");
  assert.equal(removed(), true);
});
