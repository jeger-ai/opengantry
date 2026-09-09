import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LEDGER_REF } from "../lib/constants.js";
import { getRepoRoot, gitRevParse, gitRun } from "../lib/git.js";
import { GXT_ERROR } from "../lib/gxt-error-codes.js";
import {
  buildLedgerEntry,
  entryHash,
  genesisPrevHash,
} from "../lib/ledger/ledger-entry.js";
import {
  casUpdateLedgerRef,
  commitLedgerEntry,
  readLedgerTip,
} from "../lib/ledger/ledger-ref.js";
import { appendLedgerEntry } from "../lib/ledger/ledger-append.js";
import { verifyLedgerChain } from "../lib/ledger/ledger-verify.js";
import { gitInitCommit, writeOrgExportConfig } from "./test-fixtures.js";
import { PLANNER_EMAIL } from "./test-shared.js";
import { appendLedgerFixture, writeLedgerEnabledConfig } from "./test-org-fixtures.js";

function freshRepo(): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ledger-"));
  fs.writeFileSync(path.join(dest, "README.md"), "ledger fixture\n", "utf8");
  gitInitCommit(dest, "chore: init", PLANNER_EMAIL);
  writeLedgerEnabledConfig(dest);
  writeOrgExportConfig(dest);
  return dest;
}

test("ledger-ref: refuses relative or empty root", () => {
  assert.throws(() => readLedgerTip("."), /absolute repo root/);
  assert.throws(() => readLedgerTip(""), /absolute repo root/);
});

test("ledger-ref: source never spawns git without explicit -C root", () => {
  const src = fs.readFileSync(path.join(getRepoRoot(), "src/cli/lib/ledger/ledger-ref.ts"), "utf8");
  assert.match(src, /function requireRoot/);
  assert.match(src, /spawnSync\("git", \["-C", root,/);
  assert.doesNotMatch(src, /spawnSync\("git", \[(?!"-C")/);
  assert.doesNotMatch(src, /execSync\("git/);
});

test("ledger-verify: empty ref is ok", () => {
  const dest = freshRepo();
  const report = verifyLedgerChain(dest);
  assert.equal(report.ok, true);
  assert.equal(report.count, 0);
});

test("ledger-verify: chained appends verify", () => {
  const dest = freshRepo();
  appendLedgerFixture(dest, { msn_id: "MSN-0100" });
  appendLedgerFixture(dest, { msn_id: "MSN-0101" });
  const report = verifyLedgerChain(dest);
  assert.equal(report.ok, true);
  assert.equal(report.count, 2);
  assert.equal(report.entries[1]?.prev_entry_hash, entryHash(report.entries[0]!));
});

test("ledger-verify: mismatched prev_entry_hash fails", () => {
  const dest = freshRepo();
  const first = appendLedgerFixture(dest, { msn_id: "MSN-0100" });
  const tip = readLedgerTip(dest);
  const bad = buildLedgerEntry({
    kind: "receipt",
    org_id: first.org_id,
    repository_hash: first.repository_hash,
    msn_id: "MSN-0101",
    git_head: first.git_head,
    payload: { verify_status: "passed" },
    prev_entry_hash: genesisPrevHash(),
  });
  const commit = commitLedgerEntry(dest, bad, tip, false);
  assert.equal(casUpdateLedgerRef(dest, commit, tip), true);
  const report = verifyLedgerChain(dest);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.includes(GXT_ERROR.LEDGER_CHAIN_BROKEN)));
});

test("ledger-verify: rewritten ref to a non-entry commit fails", () => {
  const dest = freshRepo();
  appendLedgerFixture(dest, { msn_id: "MSN-0100" });
  const head = gitRevParse(dest, "HEAD");
  assert.ok(head);
  gitRun(dest, ["update-ref", LEDGER_REF, head]);
  const report = verifyLedgerChain(dest);
  assert.equal(report.ok, false);
});

test("ledger-verify: requireSignatures fails on unsigned commits", () => {
  const dest = freshRepo();
  appendLedgerFixture(dest, { msn_id: "MSN-0100" });
  const report = verifyLedgerChain(dest, LEDGER_REF, { requireSignatures: true });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.includes(GXT_ERROR.LEDGER_UNSIGNED)));
});

test("ledger-verify: CAS rejects stale expected-old then retry succeeds", () => {
  const dest = freshRepo();
  const first = appendLedgerFixture(dest, { msn_id: "MSN-0100" });
  const tip = readLedgerTip(dest);
  const a = buildLedgerEntry({
    kind: "receipt",
    org_id: first.org_id,
    repository_hash: first.repository_hash,
    msn_id: "MSN-0101",
    git_head: first.git_head,
    payload: { n: 1 },
    prev_entry_hash: entryHash(first),
  });
  const b = buildLedgerEntry({
    kind: "receipt",
    org_id: first.org_id,
    repository_hash: first.repository_hash,
    msn_id: "MSN-0102",
    git_head: first.git_head,
    payload: { n: 2 },
    prev_entry_hash: entryHash(first),
  });
  const ca = commitLedgerEntry(dest, a, tip, false);
  const cb = commitLedgerEntry(dest, b, tip, false);
  assert.equal(casUpdateLedgerRef(dest, ca, tip), true);
  assert.equal(casUpdateLedgerRef(dest, cb, tip), false);
  const retried = appendLedgerEntry(dest, {
    kind: "receipt",
    msn_id: "MSN-0103",
    payload: { n: 3 },
    sign: false,
  });
  assert.equal(retried.msn_id, "MSN-0103");
  const report = verifyLedgerChain(dest);
  assert.equal(report.ok, true);
  assert.equal(report.count, 3);
});
