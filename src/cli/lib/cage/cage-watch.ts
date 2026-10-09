import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCageChanges, type CageResolvedChange } from "./cage-revert.js";
import type { CagePlan } from "./cage-rules.js";
import { diffCageSnapshots, takeCageSnapshot, type CageSnapshot, type CageSnapshotOptions } from "./cage-snapshot.js";

/** Default live-check interval while the caged command runs. */
export const CAGE_DEFAULT_WATCH_INTERVAL_MS = 1000;
/** Live restores of one path before cage stops fighting the command and restores it only at exit. */
export const CAGE_CONTEST_LIMIT = 3;

const BELL = "\x07";

/** Append-only session event log in the OS temp dir: one JSON object per line, never file bodies. */
export interface CageSessionLog {
  path: string;
  append(event: Record<string, unknown>): void;
}

export function openCageSessionLog(dir = os.tmpdir()): CageSessionLog {
  const file = path.join(dir, `gantry-cage-${String(process.pid)}-${crypto.randomBytes(4).toString("hex")}.log`);
  fs.writeFileSync(file, "", { mode: 0o600 });
  return {
    path: file,
    append(event) {
      fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
    },
  };
}

export interface CageWatchSummary {
  liveRestores: number;
  contested: string[];
  /** Live-resolved revert-rule changes, by path; the exit report merges these with the final diff. */
  restored: Map<string, CageResolvedChange>;
}

export interface CageWatcher {
  stop(): CageWatchSummary;
}

interface WatchState {
  restoresByPath: Map<string, number>;
  contested: Set<string>;
  unrestorable: Set<string>;
  restored: Map<string, CageResolvedChange>;
  liveRestores: number;
}

function noteEvent(log: CageSessionLog, bell: () => void, event: Record<string, unknown>): void {
  log.append(event);
  bell();
}

function handleLiveChange(change: CageResolvedChange, state: WatchState, log: CageSessionLog, bell: () => void): void {
  const base = { path: change.rel, kind: change.kind, rule: change.rule };
  if (change.outcome === "reverted" || change.outcome === "removed") {
    state.liveRestores += 1;
    state.restored.set(change.abs, change);
    noteEvent(log, bell, { event: "restored", ...base, outcome: change.outcome });
    return;
  }
  if (!state.unrestorable.has(change.abs)) {
    state.unrestorable.add(change.abs);
    noteEvent(log, bell, { event: change.outcome, ...base, error_code: change.errorCode });
  }
}

function tick(plan: CagePlan, baseline: CageSnapshot, opts: CageSnapshotOptions, state: WatchState, log: CageSessionLog, bell: () => void): void {
  const current = takeCageSnapshot(plan, { ...opts, keepBytes: false });
  const pending = diffCageSnapshots(baseline, current).filter((c) => {
    if (c.mode !== "revert" || state.contested.has(c.abs)) return false;
    const count = state.restoresByPath.get(c.abs) ?? 0;
    if (count < CAGE_CONTEST_LIMIT) return true;
    state.contested.add(c.abs);
    noteEvent(log, bell, { event: "contested", path: c.rel, rule: c.rule, live_restores: count });
    return false;
  });
  for (const change of resolveCageChanges(pending, { reportOnly: false })) {
    if (change.outcome === "reverted" || change.outcome === "removed") {
      state.restoresByPath.set(change.abs, (state.restoresByPath.get(change.abs) ?? 0) + 1);
    }
    handleLiveChange(change, state, log, bell);
  }
}

/**
 * Re-snapshot the protected set on an interval while the command runs and restore revert-rule changes
 * from the baseline bytes. Lockfiles stay report-only and are left for the exit report. A path restored
 * {@link CAGE_CONTEST_LIMIT} times is marked contested and restored only at exit.
 */
export function startCageWatch(input: {
  plan: CagePlan;
  baseline: CageSnapshot;
  snapshotOptions: CageSnapshotOptions;
  intervalMs: number;
  log: CageSessionLog;
  bell?: () => void;
}): CageWatcher {
  const bell = input.bell ?? (() => process.stderr.write(BELL));
  const state: WatchState = {
    restoresByPath: new Map(),
    contested: new Set(),
    unrestorable: new Set(),
    restored: new Map(),
    liveRestores: 0,
  };
  const timer = setInterval(() => {
    try {
      tick(input.plan, input.baseline, input.snapshotOptions, state, input.log, bell);
    } catch (err) {
      input.log.append({ event: "watch_error", message: err instanceof Error ? err.message : String(err) });
    }
  }, input.intervalMs);
  return {
    stop() {
      clearInterval(timer);
      const rel = (abs: string): string =>
        state.restored.get(abs)?.rel ?? path.relative(input.plan.root, abs).split(path.sep).join("/");
      return {
        liveRestores: state.liveRestores,
        contested: [...state.contested].map(rel).sort(),
        restored: state.restored,
      };
    },
  };
}
