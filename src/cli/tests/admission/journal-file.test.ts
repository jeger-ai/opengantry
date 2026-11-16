/**
 * The admission journal file and its run-record anchor (issue #356 slice 3, owner decision Q6): one exclusive lock with
 * no stale takeover, fsynced appends, a cap that refuses rather than drops, and verify catching a cut or a rewrite.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { evaluateRunRecord, RUN_RECORD_SCHEMA, type RunRecord } from "#core/run-record.js";
import { verifyAdmissionJournal } from "#core/admission-journal.js";
import { ADMISSION_JOURNAL_REL, AdmissionJournalFile, AdmissionJournalFileError, admissionJournalPath, withAdmissionJournalLock } from "#missions/admission/journal-file.js";
import { admissionJournalAnchorForRecord, admissionJournalProblem } from "#missions/mission-verify/run-record.js";
import { brokerRepo, openBroker, writeMessage, writePolicy } from "./fixtures.js";

function receipt(i: number): Parameters<AdmissionJournalFile["append"]>[0] {
  return {
    schema: "opengantry.admission-receipt.v1",
    receiptKind: "effect",
    operationId: `op-${i}`,
    attemptId: "at-1",
    requestDigest: "a".repeat(64),
    actorIdentity: { harness: "claude-code", sessionId: "s", taskId: "t" },
    capabilityId: "ubuntu-26.04-x64/claude-code/workspace.write",
    observedLevel: "unproven",
    state: "confirmed",
    ambiguity: null,
    provenance: { observer: "test", evidenceDigest: null },
  };
}

function journalWith(n: number): { root: string; file: string; journal: AdmissionJournalFile } {
  const { root } = brokerRepo();
  const file = admissionJournalPath(root)!;
  const { journal } = AdmissionJournalFile.open(file);
  for (let i = 0; i < n; i += 1) journal.append(receipt(i));
  return { root, file, journal };
}

test("the journal lives under the git dir and every appended line verifies", () => {
  const { root, file, journal } = journalWith(3);
  assert.equal(file, path.join(fs.realpathSync(path.join(root, ".git")), ...ADMISSION_JOURNAL_REL.split("/")));
  const verdict = verifyAdmissionJournal(fs.readFileSync(file, "utf8"), journal.anchor);
  assert.equal(verdict.ok, true);
  assert.equal(journal.anchor.count, 3);
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), "600");
});

test("a lock held by someone else is waited for and then refused; it is never taken over", () => {
  const { file, journal } = journalWith(1);
  const lock = `${file}.lock`;
  fs.writeFileSync(lock, "someone else\n");
  const reopened = AdmissionJournalFile.open;
  assert.throws(() => withAdmissionJournalLock(file, () => 1, 50), (e: unknown) => e instanceof AdmissionJournalFileError && e.code === "locked");
  assert.throws(() => reopened(file, { lockWaitMs: 50 }), /locked/);
  assert.equal(fs.readFileSync(lock, "utf8"), "someone else\n", "the foreign lock is left in place");
  fs.rmSync(lock);
  journal.append(receipt(9));
  assert.equal(fs.existsSync(lock), false, "our own lock is released");
});

test("opening a journal that does not verify is refused, never repaired", () => {
  const { file } = journalWith(2);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  fs.writeFileSync(file, `${lines[1]}\n${lines[0]}\n`);
  assert.throws(() => AdmissionJournalFile.open(file), (e: unknown) => e instanceof AdmissionJournalFileError && e.code === "invalid");
});

test("the cap refuses new records, lets an outcome use the reserve, and drops nothing", () => {
  const { root } = brokerRepo();
  const file = admissionJournalPath(root)!;
  const oneRecord = Buffer.byteLength(fs.readFileSync(journalWith(1).file, "utf8"));
  const { journal } = AdmissionJournalFile.open(file, { maxBytes: oneRecord + 10, reserveBytes: 2 * oneRecord });
  journal.append(receipt(0));
  assert.throws(() => journal.append(receipt(1)), (e: unknown) => e instanceof AdmissionJournalFileError && e.code === "full");
  journal.append(receipt(1), { outcome: true });
  assert.equal(verifyAdmissionJournal(fs.readFileSync(file, "utf8")).ok, true);
  assert.equal(journal.anchor.count, 2);
  assert.equal(journal.hasRoomForNewDispatch(), false);
});

test("run record: the anchor binds the journal; a later append still matches", () => {
  const { root, journal } = journalWith(2);
  const anchor = admissionJournalAnchorForRecord(root);
  assert.deepEqual(anchor, { path: ADMISSION_JOURNAL_REL, count: 2, head_digest: journal.anchor.headDigest });
  journal.append(receipt(5));
  assert.equal(admissionJournalProblem(root, anchor), null);
});

test("run record: no journal, no anchor (the field stays absent)", () => {
  const { root } = brokerRepo();
  assert.equal(admissionJournalAnchorForRecord(root), undefined);
});

test("run record: verify detects a journal truncated at a record boundary", () => {
  const { root, file } = journalWith(3);
  const anchor = admissionJournalAnchorForRecord(root);
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  fs.writeFileSync(file, `${lines.slice(0, 2).join("\n")}\n`);
  assert.match(admissionJournalProblem(root, anchor) ?? "", /truncated/);
});

test("run record: verify detects a journal rewritten from genesis with the same count", () => {
  const { root, file } = journalWith(3);
  const anchor = admissionJournalAnchorForRecord(root);
  fs.rmSync(file);
  const { journal } = AdmissionJournalFile.open(file);
  for (let i = 10; i < 13; i += 1) journal.append(receipt(i));
  assert.match(admissionJournalProblem(root, anchor) ?? "", /anchor_mismatch/);
});

test("run record: verify detects a deleted journal and a malformed anchor field", () => {
  const { root, file } = journalWith(1);
  const anchor = admissionJournalAnchorForRecord(root)!;
  fs.rmSync(file);
  assert.match(admissionJournalProblem(root, anchor) ?? "", /missing/);
  assert.match(admissionJournalProblem(root, { ...anchor, count: -1 }) ?? "", /malformed/);
  assert.match(admissionJournalProblem(root, { ...anchor, path: "../elsewhere" }) ?? "", /malformed/);
});

test("run record: --record refuses to bind an anchor to a damaged journal", () => {
  const { root, file } = journalWith(2);
  fs.appendFileSync(file, "{\"half\":");
  assert.throws(() => admissionJournalAnchorForRecord(root), /GXT_ADMISSION_JOURNAL_INVALID|does not verify/);
});

test("run record: a journal problem is a mismatch finding (GXT_RUN_RECORD_MISMATCH)", () => {
  const record: RunRecord = {
    schema: RUN_RECORD_SCHEMA,
    kind: "verify",
    msn_id: "MSN-0386",
    mission_path: "m.yaml",
    head: "a".repeat(40),
    tree: "b".repeat(40),
    law_sha256: "c".repeat(64),
    checks: [],
    status: "PASS",
    issued_at: "2026-11-16T00:00:00.000Z",
    admission_journal: { path: ADMISSION_JOURNAL_REL, count: 3, head_digest: "d".repeat(64) },
  };
  const base = { msnId: "MSN-0386", missionPath: "m.yaml", lawSha256: "c".repeat(64), headIsAncestor: true, changedSinceHead: [] };
  assert.equal(evaluateRunRecord(record, { ...base, admissionJournalProblem: null }), null);
  const finding = evaluateRunRecord(record, { ...base, admissionJournalProblem: "truncated at record 2" });
  assert.equal(finding?.kind, "mismatch");
  assert.match(finding?.reason ?? "", /admission journal/);
});

test("the broker's journal is the one the run record binds", async () => {
  const { root, outside } = brokerRepo();
  const { broker } = openBroker(root, writePolicy(path.join(outside, "policy.json")));
  await broker.handle(writeMessage(broker, root, "a.txt", "x"));
  assert.equal(admissionJournalAnchorForRecord(root)?.count, 3);
});
