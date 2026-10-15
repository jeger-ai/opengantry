import crypto from "node:crypto";
import fs from "node:fs";
import type { CageJournalHandle } from "./cage-journal.js";
import { resolveCageChanges, type CageResolvedChange } from "./cage-revert.js";
import type { CagePlan, CageRuleId } from "./cage-rules.js";
import {
  diffCageSnapshots,
  takeCageSnapshot,
  type CageChange,
  type CageEntry,
  type CageSnapshot,
  type CageSnapshotOptions,
} from "./cage-snapshot.js";
import type { CageSessionLog } from "./cage-watch.js";

/** Seconds before an unanswered protected change is rejected (restored). */
export const CAGE_DEFAULT_DECISION_TIMEOUT_S = 20;
/** Rejections (incl. timeouts) of one path before watch restores it without asking for the rest of the session. */
export const CAGE_WATCH_REJECT_LIMIT = 3;

export type CageDecisionOutcome = "accepted" | "rejected" | "timed_out" | "auto_restored" | "restored_at_exit";

/** One decided change; digest-only (the sha256 of the content decided on, never the content). */
export interface CageDecision {
  path: string;
  rule: CageRuleId;
  kind: CageChange["kind"];
  outcome: CageDecisionOutcome;
  sha256_after: string | null;
}

/** What a desktop notification and the terminal prompt may carry: path, rule and kind only. */
export interface CageDecisionAlert {
  path: string;
  rule: CageRuleId;
  kind: CageChange["kind"];
}

interface Pending {
  abs: string;
  rel: string;
  rule: CageRuleId;
  kind: CageChange["kind"];
  /** Current content hash (null when deleted); updated every tick while pending. */
  sha: string | null;
  /** The hash the operator was shown; accept applies only while the file still has it. */
  shownSha: string | null | undefined;
  deadline: number;
}

export interface CageDecisionEngineInput {
  plan: CagePlan;
  baseline: CageSnapshot;
  snapshotOptions: CageSnapshotOptions;
  decisionTimeoutMs: number;
  log: CageSessionLog;
  journal: Pick<CageJournalHandle, "replaceBaseline">;
  now: () => number;
  /** Prompt and status lines for the watch terminal. */
  say: (line: string) => void;
  /** Best-effort desktop alert; informational only, it can never answer. */
  notify: (alert: CageDecisionAlert) => void;
  bell: () => void;
}

export interface CageDecisionSummary {
  decisions: CageDecision[];
  /** Report-mode changes seen (lockfiles, `.cage.yaml` report entries): logged, never prompted, kept. */
  kept: { path: string; rule: CageRuleId; kind: CageChange["kind"] }[];
  contested: string[];
}

function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 12) : "deleted";
}

function sha256Hex(b: Buffer): string {
  return crypto.createHash("sha256").update(b).digest("hex");
}

/**
 * Human-in-the-loop decisions for `gantry cage watch` (MSN-0268). Every revert-rule change becomes a pending
 * decision answered only through {@link CageDecisionEngine.answer}, which the CLI feeds from the watch
 * process's own terminal. Accept keeps the change and moves the baseline, but only for the content hash the
 * operator was shown; reject, the timeout and shutdown restore from the baseline.
 */
export class CageDecisionEngine {
  private readonly pending = new Map<string, Pending>();
  private readonly rejects = new Map<string, number>();
  /** abs -> rel of paths restored without asking after repeated rejections. */
  private readonly contested = new Map<string, string>();
  private readonly decisions: CageDecision[] = [];
  private readonly kept = new Map<string, { path: string; rule: CageRuleId; kind: CageChange["kind"]; sha: string | null }>();

  constructor(private readonly input: CageDecisionEngineInput) {}

  /** Paths waiting for an answer, oldest first. */
  pendingPaths(): string[] {
    return [...this.pending.values()].map((p) => p.rel);
  }

  /** Re-snapshot, queue new changes, expire overdue decisions, and prompt for the oldest one. */
  tick(): void {
    const changes = this.currentChanges();
    const changed = new Set(changes.map((c) => c.abs));
    for (const p of [...this.pending.values()]) {
      if (!changed.has(p.abs)) this.drop(p, "resolved");
    }
    for (const c of changes) this.observe(c);
    for (const p of [...this.pending.values()]) {
      if (this.input.now() >= p.deadline) this.restore(p, "timed_out");
    }
    this.promptHead();
  }

  /** A key from the watch terminal: `a` accepts and `r` rejects the oldest pending decision. */
  answer(key: string): void {
    const head = this.pending.values().next().value;
    if (!head) return;
    if (key === "r") this.restore(head, "rejected");
    else if (key === "a") this.accept(head);
    this.promptHead();
  }

  /** Shutdown: reject every pending decision, then restore whatever else still differs from the baseline. */
  stop(): CageDecisionSummary {
    for (const p of [...this.pending.values()]) this.restore(p, "rejected");
    const leftover = this.currentChanges().filter((c) => c.mode === "revert");
    for (const r of resolveCageChanges(leftover, { reportOnly: false })) this.record(r, "restored_at_exit");
    return {
      decisions: [...this.decisions],
      kept: [...this.kept.values()].map(({ path, rule, kind }) => ({ path, rule, kind })),
      contested: [...this.contested.values()].sort(),
    };
  }

  private currentChanges(): CageChange[] {
    const current = takeCageSnapshot(this.input.plan, { ...this.input.snapshotOptions, keepBytes: false });
    return diffCageSnapshots(this.input.baseline, current);
  }

  private observe(c: CageChange): void {
    const sha = c.after?.sha256 ?? null;
    if (c.mode === "report") {
      if (this.kept.get(c.abs)?.sha !== sha) {
        this.kept.set(c.abs, { path: c.rel, rule: c.rule, kind: c.kind, sha });
        this.input.log.append({ event: "reported", path: c.rel, rule: c.rule, kind: c.kind });
      }
      return;
    }
    if (this.contested.has(c.abs)) {
      for (const r of resolveCageChanges([c], { reportOnly: false })) this.record(r, "auto_restored");
      return;
    }
    const known = this.pending.get(c.abs);
    if (known) {
      // A rewrite while pending updates what accept would keep; it never extends the deadline.
      known.sha = sha;
      known.kind = c.kind;
      return;
    }
    const p: Pending = { abs: c.abs, rel: c.rel, rule: c.rule, kind: c.kind, sha, shownSha: undefined, deadline: this.input.now() + this.input.decisionTimeoutMs };
    this.pending.set(c.abs, p);
    this.input.log.append({ event: "detected", path: p.rel, rule: p.rule, kind: p.kind, sha256_after: sha });
    this.input.bell();
    this.input.notify({ path: p.rel, rule: p.rule, kind: p.kind });
  }

  private promptHead(): void {
    const head = this.pending.values().next().value;
    if (!head || head.shownSha === head.sha) return;
    const changedAgain = head.shownSha !== undefined;
    head.shownSha = head.sha;
    const left = Math.max(0, Math.ceil((head.deadline - this.input.now()) / 1000));
    const lead = changedAgain ? "changed again" : "changed";
    this.input.say(
      `cage watch: ${head.rel} ${lead} (${head.rule}, ${head.kind}, sha256 ${shortSha(head.sha)}). Keep it? [a]ccept / [r]eject; rejected in ${String(left)}s`,
    );
  }

  private accept(p: Pending): void {
    const entry = this.currentEntry(p);
    if (entry === undefined) {
      this.input.say(`cage watch: ${p.rel} changed since you were asked; not accepted`);
      p.shownSha = undefined;
      p.sha = this.currentChanges().find((c) => c.abs === p.abs)?.after?.sha256 ?? null;
      return;
    }
    if (entry) this.input.baseline.entries.set(p.abs, entry);
    else this.input.baseline.entries.delete(p.abs);
    this.input.journal.replaceBaseline(this.input.baseline);
    this.pending.delete(p.abs);
    this.decisions.push({ path: p.rel, rule: p.rule, kind: p.kind, outcome: "accepted", sha256_after: p.shownSha ?? null });
    this.input.log.append({ event: "accepted", path: p.rel, rule: p.rule, kind: p.kind, sha256_after: p.shownSha ?? null });
    this.input.say(`cage watch: kept ${p.rel}`);
  }

  /**
   * The new baseline entry for an accept: the file as it is now, with bytes, when it still has the hash the
   * operator was shown; null when the shown state was a deletion and the file is still gone; undefined when
   * the file no longer matches what was shown (or cannot be held), so nothing is accepted.
   */
  private currentEntry(p: Pending): CageEntry | null | undefined {
    const now = this.currentChanges().find((c) => c.abs === p.abs);
    const after = now?.after ?? null;
    if (p.shownSha === null) return now && !after ? null : undefined;
    if (!after || after.sha256 !== p.shownSha) return undefined;
    if (after.type === "symlink") return after;
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(p.abs);
    } catch {
      return undefined;
    }
    if (sha256Hex(bytes) !== p.shownSha || bytes.length > this.input.snapshotOptions.maxFileBytes) return undefined;
    return { ...after, bytes };
  }

  private restore(p: Pending, outcome: "rejected" | "timed_out"): void {
    this.pending.delete(p.abs);
    const change = this.currentChanges().find((c) => c.abs === p.abs);
    if (!change) return;
    for (const r of resolveCageChanges([change], { reportOnly: false })) this.record(r, outcome);
    this.countRejection(p);
  }

  private countRejection(p: Pending): void {
    const count = (this.rejects.get(p.abs) ?? 0) + 1;
    this.rejects.set(p.abs, count);
    if (count >= CAGE_WATCH_REJECT_LIMIT && !this.contested.has(p.abs)) {
      this.contested.set(p.abs, p.rel);
      this.input.log.append({ event: "contested", path: p.rel, rule: p.rule, rejections: count });
      this.input.say(`cage watch: ${p.rel} rejected ${String(count)} times; further changes are restored without asking`);
    }
  }

  private drop(p: Pending, event: "resolved"): void {
    this.pending.delete(p.abs);
    this.input.log.append({ event, path: p.rel, rule: p.rule });
  }

  private record(r: CageResolvedChange, outcome: Exclude<CageDecisionOutcome, "accepted">): void {
    const sha = r.after?.sha256 ?? null;
    this.decisions.push({ path: r.rel, rule: r.rule, kind: r.kind, outcome, sha256_after: sha });
    this.input.log.append({ event: outcome, path: r.rel, rule: r.rule, kind: r.kind, restore: r.outcome, error_code: r.errorCode });
    if (outcome !== "restored_at_exit") this.input.say(`cage watch: restored ${r.rel} (${outcome.replace("_", " ")})`);
  }
}
