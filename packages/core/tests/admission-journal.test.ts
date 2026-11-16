/** The hash-chained admission journal (MSN-0384, ADR-0063 decision 8, owner decision Q6): append, encode, verify. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMISSION_JOURNAL_GENESIS,
  AdmissionJournalError,
  appendAdmissionJournal,
  encodeAdmissionJournalRecord,
  verifyAdmissionJournal,
} from "../src/admission-journal.js";
import type { AdmissionJournalRecord, AdmissionReceipt } from "../src/schemas/admission-schema.js";
import { D, receipts } from "./admission-fixtures.js";

function chain(rs: readonly AdmissionReceipt[] = receipts()): AdmissionJournalRecord[] {
  const out: AdmissionJournalRecord[] = [];
  for (const r of rs) out.push(appendAdmissionJournal(out.at(-1) ?? null, r));
  return out;
}

const text = (records: readonly AdmissionJournalRecord[]): string => records.map(encodeAdmissionJournalRecord).join("");

function problem(t: string, expected: string, anchor?: { count: number; headDigest: string }): void {
  const v = verifyAdmissionJournal(t, anchor);
  assert.equal(v.ok, false, `accepted, expected ${expected}`);
  if (!v.ok) assert.equal(v.problem, expected);
}

test("journal: records chain from genesis, seq counts from 0, and an intact journal verifies", () => {
  const recs = chain();
  assert.equal(recs[0].prevDigest, ADMISSION_JOURNAL_GENESIS);
  assert.equal(recs[1].prevDigest, recs[0].recordDigest);
  assert.deepEqual(recs.map((r) => r.seq), [0, 1, 2]);
  const v = verifyAdmissionJournal(text(recs), { count: 3, headDigest: recs[2].recordDigest });
  assert.deepEqual(v, { ok: true, count: 3, headDigest: recs[2].recordDigest });
  assert.deepEqual(verifyAdmissionJournal(""), { ok: true, count: 0, headDigest: ADMISSION_JOURNAL_GENESIS });
});

test("journal: a receipt the schema refuses is not journaled (nothing may dispatch)", () => {
  assert.throws(() => appendAdmissionJournal(null, { ...receipts()[1], state: "rolled-back" }), AdmissionJournalError);
  assert.throws(() => appendAdmissionJournal(null, { ...receipts()[0], rawArgs: "rm -rf /" }), AdmissionJournalError);
});

test("journal: edits, reordering and truncation are detected", () => {
  const recs = chain();
  const lines = text(recs).split("\n").slice(0, -1);
  const join = (ls: string[]): string => ls.map((l) => `${l}\n`).join("");
  problem(join([lines[0], lines[1].replace('"dispatch-intent"', '"confirmed"'), lines[2]]), "edited");
  const forged = appendAdmissionJournal(recs[0], { ...recs[1].receipt, observedLevel: "prevention" });
  problem(join([lines[0], encodeAdmissionJournalRecord(forged).trimEnd(), lines[2]]), "edited");
  problem(join([lines[1], lines[0], lines[2]]), "truncated");
  problem(join([lines[0], lines[2], lines[1]]), "reordered");
  problem(join([lines[1], lines[2]]), "truncated");
  problem(join(lines).slice(0, -5), "truncated");
  problem(join(lines).slice(0, -1), "truncated");
  problem(`${JSON.stringify(JSON.parse(lines[0]), null, 1)}\n`, "malformed");
  problem(join([lines[0], " " + lines[1], lines[2]]), "edited");
  problem("not json\n", "malformed");
});

test("journal: a cut at a record boundary or a rewritten history fails against the bound anchor; later appends pass", () => {
  const recs = chain();
  const anchor = { count: 3, headDigest: recs[2].recordDigest };
  problem(text(recs.slice(0, 2)), "truncated", anchor);
  problem(text(chain(receipts().slice(0, 2))) + encodeAdmissionJournalRecord(appendAdmissionJournal(recs[1], { ...receipts()[2], ambiguity: "timeout" })), "anchor_mismatch", anchor);
  const more = [...recs, appendAdmissionJournal(recs[2], { ...receipts()[2], state: "reconciled-failed", ambiguity: null })];
  const v = verifyAdmissionJournal(text(more), anchor);
  assert.equal(v.ok, true);
  problem(text(recs), "anchor_mismatch", { count: 3, headDigest: D("0") });
});

test("journal: an out-of-range or malformed anchor is anchor_mismatch, never a throw", () => {
  const t = text(chain());
  const head = chain()[2].recordDigest;
  for (const anchor of [
    { count: -1, headDigest: head },
    { count: 1.5, headDigest: head },
    { count: Number.NaN, headDigest: head },
    { count: Number.POSITIVE_INFINITY, headDigest: head },
    { count: 3, headDigest: "not-a-digest" },
    { count: "3", headDigest: head },
    null,
  ]) {
    assert.doesNotThrow(() => verifyAdmissionJournal(t, anchor as { count: number; headDigest: string }), JSON.stringify(anchor));
    problem(t, "anchor_mismatch", anchor as { count: number; headDigest: string });
  }
});
