/**
 * Counted, not journaled (owner decision (b), 2026-11-17): socket input that never became a well-formed request
 * (malformed, oversized, timed out), connections refused over the connection cap, and requests refused once the denial
 * budget is spent are counted per time window.
 * At most one summary line per window goes to `<git dir>/opengantry/admission/input-summary.jsonl`, next to the journal,
 * so a flood costs one line a minute, not one record a message.
 *
 * The summary is an operator signal, not evidence: it is not hash-chained and not anchored in the run record (the
 * journal's receipt schema has no record for it). Its file is capped; past the cap the counts stay in memory only.
 */
import fs from "node:fs";
import path from "node:path";

const ADMISSION_INPUT_SUMMARY_SCHEMA = "opengantry.admission-input-summary.v1";
const SUMMARY_FILE = "input-summary.jsonl";
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_BYTES = 1024 * 1024;

export type InputRefusalKind = "malformed" | "oversized" | "timed_out" | "denial_budget_exhausted" | "connection_limit";
const KINDS: readonly InputRefusalKind[] = ["malformed", "oversized", "timed_out", "denial_budget_exhausted", "connection_limit"];

type Counts = Record<InputRefusalKind, number>;
const zero = (): Counts => ({ malformed: 0, oversized: 0, timed_out: 0, denial_budget_exhausted: 0, connection_limit: 0 });

interface SummaryOptions {
  windowMs?: number;
  maxBytes?: number;
  /** Wall-clock milliseconds; a test seam. */
  now?: () => number;
}

export class AdmissionInputSummary {
  readonly file: string;
  private readonly windowMs: number;
  private readonly maxBytes: number;
  private readonly now: () => number;
  private windowStart: number;
  private counts: Counts = zero();
  private written: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(journalFile: string, opts: SummaryOptions = {}) {
    this.file = path.join(path.dirname(journalFile), SUMMARY_FILE);
    this.windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    this.now = opts.now ?? Date.now;
    this.windowStart = this.now();
    try {
      this.written = fs.statSync(this.file).size;
    } catch {
      this.written = 0;
    }
  }

  /** Flush on a timer too, so a burst followed by silence still leaves its summary. */
  start(): void {
    this.timer ??= setInterval(() => this.flush(), this.windowMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.flush(true);
  }

  note(kind: InputRefusalKind): void {
    this.flush();
    this.counts[kind] += 1;
  }

  /** Counts of the open window. */
  get pending(): Readonly<Counts> {
    return { ...this.counts };
  }

  /** Write the closed window's line (or the open one's when `force`), if it counted anything. Never throws. */
  flush(force = false): void {
    const now = this.now();
    if (!force && now - this.windowStart < this.windowMs) return;
    const counts = this.counts;
    const from = this.windowStart;
    this.counts = zero();
    this.windowStart = now;
    if (KINDS.every((k) => counts[k] === 0)) return;
    const line = `${JSON.stringify({ schema: ADMISSION_INPUT_SUMMARY_SCHEMA, from: new Date(from).toISOString(), to: new Date(now).toISOString(), counts })}\n`;
    if (this.written + Buffer.byteLength(line) > this.maxBytes) return;
    try {
      const fd = fs.openSync(this.file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW, 0o600);
      try {
        fs.writeSync(fd, line);
      } finally {
        fs.closeSync(fd);
      }
      this.written += Buffer.byteLength(line);
    } catch {
      /* a summary is best effort; the refusals were answered either way */
    }
  }
}
