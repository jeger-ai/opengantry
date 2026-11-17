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
import { ADMISSION_JOURNAL_NOT_VERIFIED_LABEL, admissionJournalAnchorForRecord, admissionJournalProblem, checkAdmissionJournalAnchor, evaluateRunRecordPhase, writeRunRecord } from "#missions/mission-verify/run-record.js";
import { brokerStateDir } from "#missions/admission/serve.js";
import { loadManifest } from "#missions/manifest.js";
import { parseMissionFile } from "#missions/mission/parser.js";
import { REL_PLANNER_ALLOWLIST } from "#missions/planner-identity.js";
import { getRepoRoot } from "#git/git.js";
import { copyMissionSchema, gitCommit, gitInitCommit, writeManifest } from "../test-fixtures.js";
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

// --- review round (PR #370): short writes, the denial budget, and the anchor where no journal exists ------------------

function denialReceipt(i: number): Parameters<AdmissionJournalFile["append"]>[0] {
  return {
    schema: "opengantry.admission-receipt.v1",
    receiptKind: "decision",
    operationId: `op-d${i}`,
    attemptId: "at-1",
    requestDigest: "a".repeat(64),
    actorIdentity: { harness: "claude-code", sessionId: "s", taskId: "t" },
    capabilityId: null,
    observedLevel: "unsupported",
    decision: "deny",
    decisionDigest: "b".repeat(64),
    policyRuleIds: ["broker-nonce-unknown"],
    reasonCodes: ["permit_unknown"],
    resolvedPolicyDigest: null,
    acceptedContractDigest: "c".repeat(64),
  };
}

test("a short write (ENOSPC after part of the line) is cut back and refused, never fsynced as durable", () => {
  const { root } = brokerRepo();
  const file = admissionJournalPath(root)!;
  let calls = 0;
  const write = (fd: number, buf: Buffer, off: number, len: number): number => {
    calls += 1;
    if (calls === 2) return fs.writeSync(fd, buf, off, Math.floor(len / 2));
    if (calls === 3) throw Object.assign(new Error("no space"), { code: "ENOSPC" });
    return fs.writeSync(fd, buf, off, len);
  };
  const { journal } = AdmissionJournalFile.open(file, { write });
  journal.append(receipt(0));
  const before = fs.statSync(file).size;
  assert.throws(() => journal.append(receipt(1)), (e: unknown) => e instanceof AdmissionJournalFileError && e.code === "io" && /ENOSPC/.test(e.message));
  assert.equal(fs.statSync(file).size, before, "the partial line was cut back");
  assert.equal(journal.anchor.count, 1);
  assert.equal(journal.brokenReason, null, "a cut-back journal stays usable");
  journal.append(receipt(2));
  const verdict = verifyAdmissionJournal(fs.readFileSync(file, "utf8"));
  assert.equal(verdict.ok && verdict.count, 2);
});

test("a write that makes no progress is refused and leaves the journal unchanged", () => {
  const { root } = brokerRepo();
  const file = admissionJournalPath(root)!;
  const { journal } = AdmissionJournalFile.open(file, { write: () => 0 });
  assert.throws(() => journal.append(receipt(0)), (e: unknown) => e instanceof AdmissionJournalFileError && /ESHORTWRITE|short write/.test(e.message));
  assert.equal(fs.existsSync(file) ? fs.statSync(file).size : 0, 0);
});

test("refusal receipts have their own budget: once spent they are refused, and dispatch records still fit", () => {
  const { root } = brokerRepo();
  const file = admissionJournalPath(root)!;
  const { journal } = AdmissionJournalFile.open(file, { denialMaxBytes: 2500, maxBytes: 64 * 1024 });
  let denied = 0;
  assert.throws(() => {
    for (;;) journal.append(denialReceipt((denied += 1)));
  }, (e: unknown) => e instanceof AdmissionJournalFileError && e.code === "denial_full");
  assert.equal(journal.denialBudgetExhausted, true);
  assert.ok(journal.budgets.denialBytes <= 2500);
  assert.equal(journal.hasRoomForNewDispatch(), true, "the dispatch budget is untouched");
  journal.append(receipt(1));
  journal.append(receipt(2), { outcome: true });
  const reopened = AdmissionJournalFile.open(file, { denialMaxBytes: 2500 });
  assert.deepEqual(reopened.journal.budgets, journal.budgets, "both budgets are recounted from the file");
});

test("anchor (owner decision (a)): a clone without an admission dir is labelled not verified here, never failed or verified", () => {
  const { root } = journalWith(2);
  const anchor = admissionJournalAnchorForRecord(root)!;
  const { root: clone } = brokerRepo();
  const check = checkAdmissionJournalAnchor(clone, anchor);
  assert.equal(check.status, "not_verified_here");
  assert.match(check.status === "not_verified_here" ? check.detail : "", /anchors 2 admission journal records/);
  assert.equal(admissionJournalProblem(clone, anchor), null);
});

test("anchor: its format is checked strictly even where the journal cannot be", () => {
  const { root } = brokerRepo();
  const good = { path: ADMISSION_JOURNAL_REL, count: 2, head_digest: "d".repeat(64) };
  assert.equal(checkAdmissionJournalAnchor(root, good).status, "not_verified_here");
  for (const bad of [
    { ...good, extra: 1 },
    { ...good, count: 1.5 },
    { ...good, count: "2" },
    { ...good, count: -1 },
    { ...good, head_digest: "D".repeat(64) },
    { ...good, head_digest: "d".repeat(63) },
    { path: ADMISSION_JOURNAL_REL, count: 2 },
    [good],
    null,
  ]) {
    assert.equal(checkAdmissionJournalAnchor(root, bad).status, "mismatch", JSON.stringify(bad));
  }
});

test("anchor: a local journal truncated, or an admission dir whose journal was deleted, still fails", () => {
  const { root, file } = journalWith(3);
  const anchor = admissionJournalAnchorForRecord(root)!;
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  fs.writeFileSync(file, `${lines.slice(0, 1).join("\n")}\n`);
  assert.equal(checkAdmissionJournalAnchor(root, anchor).status, "mismatch");
  fs.rmSync(file);
  assert.equal(checkAdmissionJournalAnchor(root, anchor).status, "mismatch", "the admission dir exists, its journal is gone");
});

test("anchor: an admission dir removed on a host where a broker served the repository fails, not 'not verified here'", () => {
  const { root, file } = journalWith(2);
  const anchor = admissionJournalAnchorForRecord(root)!;
  fs.rmSync(path.dirname(file), { recursive: true });
  const saved = process.env.GANTRY_STATE_DIR;
  const state = fs.mkdtempSync(path.join(path.dirname(path.dirname(root)), "og-state-"));
  process.env.GANTRY_STATE_DIR = state;
  try {
    assert.equal(checkAdmissionJournalAnchor(root, anchor).status, "not_verified_here");
    fs.mkdirSync(brokerStateDir(root, path.dirname(path.dirname(path.dirname(file)))), { recursive: true });
    const check = checkAdmissionJournalAnchor(root, anchor);
    assert.equal(check.status, "mismatch");
    assert.match(check.status === "mismatch" ? check.problem : "", /broker served this repository/);
  } finally {
    if (saved === undefined) delete process.env.GANTRY_STATE_DIR;
    else process.env.GANTRY_STATE_DIR = saved;
  }
});

test("verify's run-record phase: an anchor not verifiable here passes with a visible label; a broken local journal fails", () => {
  const msn = "MSN-0991";
  const planner = "planner@example.com";
  const missionRel = `.gitagent/missions/${msn}.yaml`;
  const dest = fs.realpathSync(fs.mkdtempSync(path.join(path.dirname(path.dirname(brokerRepo().root)), "og-anchor-phase-")));
  copyMissionSchema(path.join(getRepoRoot(), ".gitagent", "planner"), path.join(dest, ".gitagent", "planner"));
  writeManifest(dest, { ui: { trust_threshold: "Tier-1", tmvc_roots: ["src/"], forbidden_zones: [] } });
  fs.mkdirSync(path.join(dest, path.dirname(REL_PLANNER_ALLOWLIST)), { recursive: true });
  fs.writeFileSync(path.join(dest, REL_PLANNER_ALLOWLIST), `${planner}\n`);
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  fs.writeFileSync(path.join(dest, missionRel), `msn_id: ${msn}\nskill_key: ui\ngate_command: echo OK\ngate_success_substring: OK\ntrace_rows: []\n`);
  gitInitCommit(dest, `[${msn}] Legislate`, planner);
  const ctx = () => ({ root: dest, manifest: loadManifest(dest), mission: parseMissionFile(dest, missionRel), options: {}, executorLogPath: path.join(dest, "EXECUTOR_LOG.md") });
  // A record written where a journal exists carries its anchor.
  const { journal } = AdmissionJournalFile.open(admissionJournalPath(dest)!);
  journal.append(receipt(0));
  journal.append(receipt(1));
  writeRunRecord(ctx(), msn, { command: "echo OK", exit: 0, durationMs: 1, logText: "OK\n" });
  gitCommit(dest, `[${msn}] Run record`, planner);
  const recordFile = path.join(dest, ".gitagent", "runs", `${msn}.json`);
  assert.equal((JSON.parse(fs.readFileSync(recordFile, "utf8")) as RunRecord).admission_journal?.count, 2);
  assert.deepEqual(evaluateRunRecordPhase(ctx(), msn), { kind: "ok", recordPath: `.gitagent/runs/${msn}.json`, notes: [] }, "verified where the journal lives");

  // The same record in a clone without the admission dir: passes, labelled.
  const admissionDir = path.dirname(admissionJournalPath(dest)!);
  const moved = `${admissionDir}.moved`;
  fs.renameSync(admissionDir, moved);
  const labelled = evaluateRunRecordPhase(ctx(), msn);
  assert.equal(labelled.kind, "ok");
  assert.match(labelled.kind === "ok" ? (labelled.notes[0] ?? "") : "", new RegExp(`^${ADMISSION_JOURNAL_NOT_VERIFIED_LABEL} \\(`));

  // Back, but truncated: fails.
  fs.renameSync(moved, admissionDir);
  const file = admissionJournalPath(dest)!;
  fs.writeFileSync(file, `${fs.readFileSync(file, "utf8").split("\n")[0]}\n`);
  const failed = evaluateRunRecordPhase(ctx(), msn);
  assert.equal(failed.kind, "fail");
  assert.match(failed.kind === "fail" ? failed.failure.message : "", /RUN RECORD MISMATCH: the admission journal does not match/);
});
