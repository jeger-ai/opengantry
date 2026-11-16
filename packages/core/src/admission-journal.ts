import { admissionDigest } from "./admission.js";
import { canonicalJson } from "./canonical-json.js";
import {
  ADMISSION_SCHEMA_IDS,
  admissionJournalRecordSchema,
  admissionReceiptSchema,
  type AdmissionJournalRecord,
} from "./schemas/admission-schema.js";
import { formatSchemaIssues } from "./schemas/issues.js";

/**
 * The admission journal, pure part (ADR-0063 decision 8, owner decision Q6): one canonical-JSON record per line, each
 * carrying the digest of the record before it. The file under the git dir, its fsync and the binding of its head into
 * the run record belong to the broker slice. If `appendAdmissionJournal` throws, the caller must not dispatch.
 */

/** `prevDigest` of the first record. */
export const ADMISSION_JOURNAL_GENESIS = "0".repeat(64);

export class AdmissionJournalError extends Error {}

/** Where a journal stood when it was bound (the run record keeps this). */
export interface AdmissionJournalAnchor {
  count: number;
  headDigest: string;
}

type AdmissionJournalProblem = "malformed" | "truncated" | "reordered" | "edited" | "anchor_mismatch";

type AdmissionJournalVerdict =
  | { ok: true; count: number; headDigest: string }
  | { ok: false; problem: AdmissionJournalProblem; index: number; detail: string };

/** The next record after `prev` (null for the first). Throws on a receipt the schema refuses. */
export function appendAdmissionJournal(prev: AdmissionJournalRecord | null, receipt: unknown): AdmissionJournalRecord {
  const parsed = admissionReceiptSchema.safeParse(receipt);
  if (!parsed.success) throw new AdmissionJournalError(`receipt refused: ${formatSchemaIssues(parsed.error)}`);
  const body = {
    schema: ADMISSION_SCHEMA_IDS.journalRecord,
    seq: prev === null ? 0 : prev.seq + 1,
    prevDigest: prev === null ? ADMISSION_JOURNAL_GENESIS : prev.recordDigest,
    receipt: parsed.data,
  };
  return { ...body, recordDigest: admissionDigest(body) };
}

/** One journal line: the canonical JSON of the record and a newline. */
export function encodeAdmissionJournalRecord(record: AdmissionJournalRecord): string {
  return `${canonicalJson(record)}\n`;
}

const fail = (problem: AdmissionJournalProblem, index: number, detail: string): AdmissionJournalVerdict => ({ ok: false, problem, index, detail });

function parseLine(line: string, index: number): AdmissionJournalRecord | AdmissionJournalVerdict {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return fail("malformed", index, "line is not JSON");
  }
  const parsed = admissionJournalRecordSchema.safeParse(value);
  if (!parsed.success) return fail("malformed", index, formatSchemaIssues(parsed.error));
  return parsed.data;
}

function judgeRecord(rec: AdmissionJournalRecord, line: string, index: number, prevDigest: string): AdmissionJournalVerdict | null {
  const { recordDigest, ...body } = rec;
  if (canonicalJson(rec) !== line || admissionDigest(body) !== recordDigest) return fail("edited", index, "record digest or encoding does not match");
  if (rec.seq !== index) return fail(index === 0 ? "truncated" : "reordered", index, `seq ${rec.seq} at line ${index}`);
  if (rec.prevDigest !== prevDigest) return fail("edited", index, "prevDigest does not chain to the record before");
  return null;
}

/** An anchor names a non-negative integer count and a sha256 head; anything else is refused, never indexed with. */
function anchorWellFormed(anchor: unknown): anchor is AdmissionJournalAnchor {
  const a = anchor as Partial<AdmissionJournalAnchor> | null;
  return (
    typeof a === "object" &&
    a !== null &&
    Number.isSafeInteger(a.count) &&
    (a.count as number) >= 0 &&
    typeof a.headDigest === "string" &&
    /^[0-9a-f]{64}$/.test(a.headDigest)
  );
}

function judgeAnchor(records: readonly AdmissionJournalRecord[], anchor: unknown): AdmissionJournalVerdict | null {
  if (!anchorWellFormed(anchor)) return fail("anchor_mismatch", 0, "the anchor is not a non-negative integer count with a sha256 head digest");
  if (records.length < anchor.count) return fail("truncated", records.length, `${records.length} records, anchor names ${anchor.count}`);
  const at = anchor.count === 0 ? ADMISSION_JOURNAL_GENESIS : records[anchor.count - 1].recordDigest;
  return at === anchor.headDigest ? null : fail("anchor_mismatch", Math.max(0, anchor.count - 1), "the record at the anchor is not the one bound");
}

/**
 * Verify a whole journal: every line canonical, every digest recomputed, `seq` from 0 without gaps, every
 * `prevDigest` chained. A missing head, a reordering, an edit or a partial last line fails. A cut at a record boundary
 * is caught by the anchor (count and head digest bound into the run record); records appended after the anchor pass.
 */
export function verifyAdmissionJournal(text: string, anchor?: AdmissionJournalAnchor): AdmissionJournalVerdict {
  if (text !== "" && !text.endsWith("\n")) return fail("truncated", text.split("\n").length - 1, "the last line has no newline");
  const lines = text === "" ? [] : text.slice(0, -1).split("\n");
  const records: AdmissionJournalRecord[] = [];
  let prev = ADMISSION_JOURNAL_GENESIS;
  for (const [i, line] of lines.entries()) {
    const rec = parseLine(line, i);
    if ("ok" in rec) return rec;
    const problem = judgeRecord(rec, line, i, prev);
    if (problem !== null) return problem;
    records.push(rec);
    prev = rec.recordDigest;
  }
  if (anchor !== undefined) {
    const problem = judgeAnchor(records, anchor);
    if (problem !== null) return problem;
  }
  return { ok: true, count: records.length, headDigest: prev };
}
