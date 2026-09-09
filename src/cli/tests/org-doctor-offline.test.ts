import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRepoRoot } from "../lib/git.js";
import { runLedgerDoctorChecks } from "../lib/ledger/ledger-chain.js";
import { runOrgPolicyDoctorChecks } from "../lib/policy/policy-doctor.js";
import { gitInitCommit } from "./test-fixtures.js";
import { PLANNER_EMAIL } from "./test-shared.js";
import { writeOrgPolicyRepo } from "./test-org-fixtures.js";

test("org doctor sources never clone or fetch", () => {
  const root = path.join(getRepoRoot(), "src/cli/lib");
  const files = [
    path.join(root, "policy/policy-doctor.ts"),
    path.join(root, "policy/policy-resolve.ts"),
    path.join(root, "ledger/ledger-chain.ts"),
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

test("org policy doctor: offline pointer+cache is ok", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-doctor-policy-"));
  writeOrgPolicyRepo(dest, getRepoRoot());
  const lines = runOrgPolicyDoctorChecks(dest);
  assert.ok(lines.some((l) => l.level === "ok" && l.message.includes("og-floor")));
});

test("ledger doctor: offline empty and consistent chain", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-doctor-ledger-"));
  fs.writeFileSync(path.join(dest, "README.md"), "x\n", "utf8");
  gitInitCommit(dest, "chore: init", PLANNER_EMAIL);
  const empty = runLedgerDoctorChecks(dest);
  assert.ok(empty.some((l) => l.message.includes("absent")));
});
