/**
 * The admission journal on disk (ADR-0063 decision 8, owner decision Q6; issue #356 slice 3). One file under the git
 * dir, `<git dir>/opengantry/admission/journal.jsonl`, holding the hash-chained records of `#core/admission-journal.js`.
 *
 * - Every write goes through one lock file created exclusively, with an owner token and no stale takeover (the
 *   draft-token approach, MSN-0381): a crashed writer's lock stays until the operator removes it.
 * - Every append is written, fsynced and checked before it returns. A write that fails is cut back to the last good
 *   length; if that fails too, the journal is broken and refuses every later append.
 * - Growth is capped: a new dispatch is refused once the file reaches `maxBytes`, and the outcome of a dispatch already
 *   started may use a reserve above it. Records are never dropped or rotated, so the run-record anchor stays checkable.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { appendAdmissionJournal, encodeAdmissionJournalRecord, verifyAdmissionJournal, type AdmissionJournalAnchor } from "#core/admission-journal.js";
import type { AdmissionJournalRecord, AdmissionReceipt } from "#core/schemas/admission-schema.js";
import { gitRunOk } from "#git/git.js";

/** The journal, relative to the git dir (`git rev-parse --absolute-git-dir`); a linked worktree has its own. */
export const ADMISSION_JOURNAL_REL = "opengantry/admission/journal.jsonl";
/** The documented cap: no new dispatch once the journal holds this many bytes. */
const ADMISSION_JOURNAL_MAX_BYTES = 32 * 1024 * 1024;
/** Room above the cap for the outcome records of dispatches that already started. */
const ADMISSION_JOURNAL_OUTCOME_RESERVE_BYTES = 1024 * 1024;
const LOCK_WAIT_MS = 2000;

type JournalFileErrorCode = "invalid" | "locked" | "full" | "io" | "changed" | "broken";

export class AdmissionJournalFileError extends Error {
  constructor(
    readonly code: JournalFileErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** The journal path for the repository at `root`, or null outside a git repository. */
export function admissionJournalPath(root: string): string | null {
  const r = gitRunOk(root, ["rev-parse", "--absolute-git-dir"]);
  if (!r.ok || r.stdout.trim() === "") return null;
  return path.join(r.stdout.trim(), ...ADMISSION_JOURNAL_REL.split("/"));
}

const sleep = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function readOwner(lock: string): string | null {
  try {
    return fs.readFileSync(lock, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Run `fn` holding `<file>.lock`; wait briefly for another holder, never take over a lock someone else made. */
export function withAdmissionJournalLock<T>(file: string, fn: () => T, waitMs = LOCK_WAIT_MS): T {
  const lock = `${file}.lock`;
  const owner = `${JSON.stringify({ token: crypto.randomUUID(), pid: process.pid })}\n`;
  for (const deadline = Date.now() + waitMs; ; sleep(10)) {
    try {
      fs.writeFileSync(lock, owner, { flag: "wx", mode: 0o600 });
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw new AdmissionJournalFileError("io", `admission journal lock ${lock}: ${code ?? String(err)}`);
    }
    if (Date.now() > deadline) {
      throw new AdmissionJournalFileError("locked", `admission journal locked: ${lock} exists. Another gantry process holds it, or one crashed holding it; delete it only if no gantry process is running.`);
    }
  }
  try {
    return fn();
  } finally {
    // Only the owner removes the lock; a lock replaced while held is left for the operator.
    if (readOwner(lock) === owner) fs.rmSync(lock, { force: true });
  }
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new AdmissionJournalFileError("io", `admission journal ${file}: ${(err as NodeJS.ErrnoException).code ?? String(err)}`);
  }
}

function parseRecords(text: string): AdmissionJournalRecord[] {
  return text === "" ? [] : text.slice(0, -1).split("\n").map((line) => JSON.parse(line) as AdmissionJournalRecord);
}

type JournalRead = { exists: false } | { exists: true; verdict: ReturnType<typeof verifyAdmissionJournal> };

/** Read and verify the journal under its lock (an append in progress is never read half-written). */
export function readAdmissionJournalFile(file: string, anchor?: AdmissionJournalAnchor): JournalRead {
  if (!fs.existsSync(path.dirname(file))) return { exists: false };
  return withAdmissionJournalLock(file, () => {
    const text = readText(file);
    return text === null ? { exists: false } : { exists: true, verdict: verifyAdmissionJournal(text, anchor) };
  });
}

interface JournalFileOptions {
  maxBytes?: number;
  reserveBytes?: number;
  lockWaitMs?: number;
}

/** The broker's handle on the journal: verified at open, appended to under the lock, never rewritten. */
export class AdmissionJournalFile {
  private last: AdmissionJournalRecord | null;
  private size: number;
  private count: number;
  private broken: string | null = null;
  readonly maxBytes: number;
  readonly reserveBytes: number;
  private readonly lockWaitMs: number;

  private constructor(
    readonly file: string,
    records: AdmissionJournalRecord[],
    size: number,
    opts: JournalFileOptions,
  ) {
    this.last = records.at(-1) ?? null;
    this.count = records.length;
    this.size = size;
    this.maxBytes = opts.maxBytes ?? ADMISSION_JOURNAL_MAX_BYTES;
    this.reserveBytes = opts.reserveBytes ?? ADMISSION_JOURNAL_OUTCOME_RESERVE_BYTES;
    this.lockWaitMs = opts.lockWaitMs ?? LOCK_WAIT_MS;
  }

  /**
   * Open (or create) the journal and verify every record. A journal that does not verify is refused, never repaired:
   * the returned records are what crash recovery reads.
   */
  static open(file: string, opts: JournalFileOptions = {}): { journal: AdmissionJournalFile; records: AdmissionJournalRecord[] } {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    return withAdmissionJournalLock(
      file,
      () => {
        const text = readText(file) ?? "";
        const verdict = verifyAdmissionJournal(text);
        if (!verdict.ok) throw new AdmissionJournalFileError("invalid", `admission journal ${file} does not verify: ${verdict.problem} at record ${verdict.index} (${verdict.detail})`);
        const records = parseRecords(text);
        return { journal: new AdmissionJournalFile(file, records, Buffer.byteLength(text, "utf8"), opts), records };
      },
      opts.lockWaitMs ?? LOCK_WAIT_MS,
    );
  }

  get anchor(): AdmissionJournalAnchor {
    return { count: this.count, headDigest: this.last?.recordDigest ?? "0".repeat(64) };
  }

  get sizeBytes(): number {
    return this.size;
  }

  get brokenReason(): string | null {
    return this.broken;
  }

  /** Whether a new dispatch may start: the journal is healthy and below the cap. */
  hasRoomForNewDispatch(): boolean {
    return this.broken === null && this.size < this.maxBytes;
  }

  /**
   * Append one receipt and fsync it before returning. A new dispatch's records (`outcome: false`) must fit under the
   * cap; an outcome may use the reserve. Throws on any failure: the caller must then not dispatch.
   */
  append(receipt: AdmissionReceipt, opts: { outcome?: boolean } = {}): AdmissionJournalRecord {
    if (this.broken !== null) throw new AdmissionJournalFileError("broken", `admission journal is broken: ${this.broken}`);
    const record = appendAdmissionJournal(this.last, receipt);
    const line = encodeAdmissionJournalRecord(record);
    const bytes = Buffer.byteLength(line, "utf8");
    const limit = opts.outcome === true ? this.maxBytes + this.reserveBytes : this.maxBytes;
    if (this.size + bytes > limit) throw new AdmissionJournalFileError("full", `admission journal is full (${this.size} of ${this.maxBytes} bytes); new dispatches are refused, no record is dropped`);
    withAdmissionJournalLock(this.file, () => this.writeLine(line), this.lockWaitMs);
    this.last = record;
    this.count += 1;
    this.size += bytes;
    return record;
  }

  private writeLine(line: string): void {
    const created = !fs.existsSync(this.file);
    let fd: number;
    try {
      fd = fs.openSync(this.file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW, 0o600);
    } catch (err) {
      throw new AdmissionJournalFileError("io", `admission journal ${this.file}: ${(err as NodeJS.ErrnoException).code ?? String(err)}`);
    }
    try {
      // Someone else wrote, cut or replaced the file since the last append: refuse rather than chain onto it.
      if (fs.fstatSync(fd).size !== this.size) {
        this.broken = "the journal changed outside this broker";
        throw new AdmissionJournalFileError("changed", `admission journal ${this.file} changed outside this broker`);
      }
      try {
        fs.writeSync(fd, line);
        fs.fsyncSync(fd);
      } catch (err) {
        this.cutBack(fd);
        throw new AdmissionJournalFileError("io", `admission journal write failed: ${(err as NodeJS.ErrnoException).code ?? String(err)}`);
      }
    } finally {
      fs.closeSync(fd);
    }
    if (created) fsyncDir(path.dirname(this.file));
  }

  private cutBack(fd: number): void {
    try {
      fs.ftruncateSync(fd, this.size);
      fs.fsyncSync(fd);
    } catch (err) {
      this.broken = `a failed write could not be cut back (${(err as NodeJS.ErrnoException).code ?? String(err)})`;
    }
  }
}

/** fsync a directory so a new entry in it survives a crash. */
function fsyncDir(dir: string): void {
  const fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
