import { spawn } from "node:child_process";
import { GantryUserError } from "../errors.js";
import { recoverCageJournal, resolveCageJournalDir, writeCageJournal, type CageRecovery } from "./cage-journal.js";
import { buildCagePlan } from "./cage-rules.js";
import { CAGE_DEFAULT_MAX_FILE_BYTES, CAGE_DEFAULT_MAX_TOTAL_BYTES, resolveCageRoot } from "./cage-run.js";
import { takeCageSnapshot, type CageSnapshotOptions } from "./cage-snapshot.js";
import { CAGE_DEFAULT_WATCH_INTERVAL_MS, openCageSessionLog } from "./cage-watch.js";
import {
  CAGE_DEFAULT_DECISION_TIMEOUT_S,
  CageDecisionEngine,
  type CageDecision,
  type CageDecisionAlert,
  type CageDecisionSummary,
} from "./cage-watch-decisions.js";

export const CAGE_WATCH_SCHEMA = "gantry.cage-watch.v1" as const;

/** What `gantry cage watch` cannot do; printed with every report. */
export const CAGE_WATCH_LIMITS: readonly string[] = [
  "Restores after the fact: a change stays live until you answer or the decision timeout passes.",
  "Cannot tell which process changed a file: no halt and no push guard; wrap scripted agent runs with gantry cage -- <cmd>.",
  "Reads, network side effects and writes outside the protected set are not seen.",
  "Any process of your user can stop the watch; the next cage or watch run in this repo restores from the journal.",
  "Answers are only as private as this terminal: inside tmux or screen, or a terminal an agent can automate, keystrokes can be injected.",
];

const CTRL_C = "\u0003";
const BELL = "\x07";

/** Raw-mode terminal input: the only channel that can answer a decision. */
export interface CageWatchInput extends NodeJS.EventEmitter {
  isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  resume(): unknown;
  pause(): unknown;
}

export interface CageWatchRunOptions {
  cwd?: string;
  decisionTimeoutS?: number;
  watchIntervalMs?: number;
  maxFileBytes?: number;
  /** Desktop notifications (default true); they only alert, they never answer. */
  notify?: boolean | ((alert: CageDecisionAlert) => void);
  /** Default `process.stdin`; must be a TTY. */
  input?: CageWatchInput;
  say?: (line: string) => void;
  bell?: () => void;
  onRecovery?: (recovery: CageRecovery) => void;
}

/** Digest-only exit report: paths, rules and hashes, never file bodies. */
export interface CageWatchReport {
  report_schema: typeof CAGE_WATCH_SCHEMA;
  status: "clean" | "restored";
  exit_code: 0 | 3;
  root: string;
  decision_timeout_s: number;
  protected_files: number;
  decisions: CageDecision[];
  kept: CageDecisionSummary["kept"];
  contested: string[];
  trapped_signal: string | null;
  recovery: { previous_pid: number; started_at: string; restored: number } | null;
  session_log: string;
  limits: readonly string[];
}

/** Best-effort desktop alert naming path and rule only. Arguments are passed as argv, never interpolated into a script. */
export function desktopNotify(alert: CageDecisionAlert): void {
  const text = `${alert.path} changed (${alert.rule}); answer in the gantry cage watch terminal`;
  const cmd =
    process.platform === "darwin"
      ? ["osascript", "-e", "on run argv", "-e", 'display notification (item 1 of argv) with title "gantry cage watch"', "-e", "end run", text]
      : process.platform === "linux"
        ? ["notify-send", "--app-name=gantry", "gantry cage watch", text]
        : null;
  if (!cmd) return;
  try {
    const child = spawn(cmd[0]!, cmd.slice(1), { stdio: "ignore", detached: false });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // No notifier installed: the bell and the terminal prompt still alert.
  }
}

function notifier(opt: CageWatchRunOptions["notify"]): (alert: CageDecisionAlert) => void {
  if (typeof opt === "function") return opt;
  return opt === false ? () => undefined : desktopNotify;
}

function requireTty(input: CageWatchInput): void {
  if (input.isTTY && typeof input.setRawMode === "function") return;
  throw new GantryUserError(
    "GXT_CAGE_WATCH_NO_TTY",
    "cage watch: stdin is not a terminal; decisions can only be answered in the terminal that runs the watch",
    "Start gantry cage watch in its own terminal window. For scripted agent runs use gantry cage -- <cmd>.",
    2,
  );
}

/** Resolve when the operator presses Ctrl-C in the watch terminal or the process gets SIGINT/SIGTERM/SIGHUP. */
function waitForStop(input: CageWatchInput, onKey: (key: string) => void): { done: Promise<string | null>; cleanup(): void } {
  let finish: (signal: string | null) => void = () => undefined;
  const done = new Promise<string | null>((resolve) => (finish = resolve));
  const onData = (chunk: Buffer | string): void => {
    for (const key of chunk.toString()) {
      if (key === CTRL_C) finish(null);
      else onKey(key.toLowerCase());
    }
  };
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  const handlers = signals.map((sig) => [sig, () => finish(sig)] as const);
  input.on("data", onData);
  for (const [sig, h] of handlers) process.on(sig, h);
  return {
    done,
    cleanup() {
      input.off("data", onData);
      for (const [sig, h] of handlers) process.off(sig, h);
    },
  };
}

/**
 * `gantry cage watch` (MSN-0268): watch the protected set on disk, gitignored files included, without wrapping
 * any process. Every revert-rule change is a decision for the operator in this terminal; unanswered changes are
 * restored after the decision timeout. Shares the journal with the session cage, so the two never run at once
 * in one root and a kill -9 on either is recovered by the next run.
 */
export async function runCageWatch(opts: CageWatchRunOptions = {}): Promise<CageWatchReport> {
  const input: CageWatchInput = opts.input ?? process.stdin;
  requireTty(input);
  const root = resolveCageRoot(opts.cwd ?? process.cwd());
  const snap: CageSnapshotOptions = {
    keepBytes: true,
    maxFileBytes: opts.maxFileBytes ?? CAGE_DEFAULT_MAX_FILE_BYTES,
    maxTotalBytes: CAGE_DEFAULT_MAX_TOTAL_BYTES,
  };
  const journalDir = resolveCageJournalDir(root);
  const recovery = recoverCageJournal(root, journalDir, snap);
  if (recovery) opts.onRecovery?.(recovery);
  const plan = buildCagePlan(root);
  const baseline = takeCageSnapshot(plan, snap);
  const journal = writeCageJournal(journalDir, root, baseline, []);
  const log = openCageSessionLog();
  const timeoutS = opts.decisionTimeoutS ?? CAGE_DEFAULT_DECISION_TIMEOUT_S;
  const say = opts.say ?? ((line: string) => process.stderr.write(`${line}\r\n`));
  const engine = new CageDecisionEngine({
    plan,
    baseline,
    snapshotOptions: snap,
    decisionTimeoutMs: timeoutS * 1000,
    log,
    journal,
    now: Date.now,
    say,
    notify: notifier(opts.notify),
    bell: opts.bell ?? (() => process.stderr.write(BELL)),
  });
  say(
    `cage watch: watching ${String(baseline.entries.size)} protected file(s) in ${root}; answer prompts here with a or r (unanswered: restored after ${String(timeoutS)}s); Ctrl-C stops; live events: ${log.path}`,
  );

  const guarded = (fn: () => void): void => {
    try {
      fn();
    } catch (err) {
      log.append({ event: "watch_error", message: err instanceof Error ? err.message : String(err) });
    }
  };
  const stop = waitForStop(input, (key) => guarded(() => engine.answer(key)));
  input.setRawMode!(true);
  input.resume();
  const timer = setInterval(() => guarded(() => engine.tick()), opts.watchIntervalMs ?? CAGE_DEFAULT_WATCH_INTERVAL_MS);
  let trapped: string | null = null;
  try {
    trapped = await stop.done;
  } finally {
    clearInterval(timer);
    stop.cleanup();
    input.setRawMode!(false);
    input.pause();
  }
  const summary = engine.stop();
  journal.dispose();
  const restoredAny = summary.decisions.some((d) => d.outcome !== "accepted");
  return {
    report_schema: CAGE_WATCH_SCHEMA,
    status: restoredAny ? "restored" : "clean",
    exit_code: restoredAny ? 3 : 0,
    root,
    decision_timeout_s: timeoutS,
    protected_files: baseline.entries.size,
    decisions: summary.decisions,
    kept: summary.kept,
    contested: summary.contested,
    trapped_signal: trapped,
    recovery: recovery ? { previous_pid: recovery.previousPid, started_at: recovery.startedAt, restored: recovery.restored.length } : null,
    session_log: log.path,
    limits: CAGE_WATCH_LIMITS,
  };
}

/** Human summary for stderr. */
export function formatCageWatchReport(r: CageWatchReport): string[] {
  const kept = r.decisions.filter((d) => d.outcome === "accepted");
  const restored = r.decisions.filter((d) => d.outcome !== "accepted");
  const lines = [`cage watch: stopped${r.trapped_signal ? ` (${r.trapped_signal})` : ""}; kept ${String(kept.length)}, restored ${String(restored.length)}`];
  for (const d of r.decisions) lines.push(`  ${d.path}  ${d.rule}  ${d.outcome.replace(/_/g, " ")}`);
  if (r.kept.length > 0) lines.push("cage watch: reported only (kept):", ...r.kept.map((k) => `  ${k.path}  ${k.rule}`));
  if (r.contested.length > 0) lines.push(`cage watch: restored without asking after repeated rejections: ${r.contested.join(", ")}`);
  lines.push(`cage watch: session log: ${r.session_log}`, "cage watch: limits:", ...r.limits.map((l) => `  - ${l}`));
  return lines;
}
