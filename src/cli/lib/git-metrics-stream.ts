import { GXT_BYPASS_NOTES_REF } from "./break-glass.js";
import { MSN_ID_PATTERN, WORKER_LOG_FILENAME } from "./constants.js";
import { parseTeacherEmailsFromEnv, commitSubjectHasMsnPrefix } from "./git-proof.js";
import { gitRunOk } from "./git-repo.js";
import { msnFromMissionPath } from "./git-metrics-missions.js";

export interface LogRecord {
  hash: string;
  subject: string;
  email: string;
  ts: string;
}

const diffCache = new Map<string, string[]>();

export function streamLogRecords(root: string, ref: string): LogRecord[] {
  const r = gitRunOk(
    root,
    ["log", ref, "-z", "--reverse", "--format=%H%x1f%s%x1f%aE%x1f%cI"],
    64 * 1024 * 1024,
  );
  if (!r.ok || !r.stdout.trim()) return [];

  const records: LogRecord[] = [];
  for (const chunk of r.stdout.split("\0").filter((c) => c.length > 0)) {
    const parts = chunk.split("\x1f");
    if (parts.length < 4) continue;
    const [hash, subject, email, ts] = parts;
    if (!hash || !subject || !email || !ts) continue;
    records.push({ hash, subject, email, ts });
  }
  return records;
}

export function countBypassNotes(root: string): number {
  const r = gitRunOk(root, ["notes", `--ref=${GXT_BYPASS_NOTES_REF}`, "list"]);
  if (!r.ok || !r.stdout.trim()) return 0;
  return r.stdout.split("\n").filter((l) => l.trim().length > 0).length;
}

function commitChangedPaths(root: string, hash: string): string[] {
  const cached = diffCache.get(hash);
  if (cached) return cached;
  const r = gitRunOk(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", hash]);
  const paths = r.ok
    ? r.stdout
        .split("\n")
        .map((p) => p.trim().replace(/\\/g, "/"))
        .filter((p) => p.length > 0)
    : [];
  diffCache.set(hash, paths);
  return paths;
}

function isTeacherEmail(email: string): boolean {
  const allow = parseTeacherEmailsFromEnv();
  if (allow.length === 0) return false;
  return allow.includes(email.trim().toLowerCase());
}

function subjectMsnId(subject: string): string | null {
  const m = subject.trim().match(/^\[(MSN-\d{4})\]/);
  const id = m?.[1];
  return id && MSN_ID_PATTERN.test(id) ? id : null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const a = sorted[mid - 1];
    const b = sorted[mid];
    if (a === undefined || b === undefined) return null;
    return (a + b) / 2;
  }
  return sorted[mid] ?? null;
}

export function clearMetricsDiffCache(): void {
  diffCache.clear();
}

export function aggregateFromLogStream(
  root: string,
  records: LogRecord[],
): {
  missionIdsFromLog: Set<string>;
  legislative: number;
  worker_trace: number;
  bypass_audit: number;
  firstSeen: Map<string, number>;
  lastSeen: Map<string, number>;
} {
  const missionIdsFromLog = new Set<string>();
  let legislative = 0;
  let worker_trace = 0;
  let bypass_audit = 0;
  const firstSeen = new Map<string, number>();
  const lastSeen = new Map<string, number>();

  for (const rec of records) {
    const ts = Date.parse(rec.ts);
    if (!Number.isFinite(ts)) continue;

    if (rec.subject.trim().startsWith("[GXT-AUDIT] break-glass:")) {
      bypass_audit++;
    }

    const msnFromSubject = subjectMsnId(rec.subject);
    if (msnFromSubject) missionIdsFromLog.add(msnFromSubject);

    const paths = commitChangedPaths(root, rec.hash);
    let touchesMission = false;
    let touchesWorkerLog = false;

    for (const p of paths) {
      if (p === WORKER_LOG_FILENAME) touchesWorkerLog = true;
      const msnFromPath = msnFromMissionPath(p);
      if (msnFromPath) {
        touchesMission = true;
        if (!firstSeen.has(msnFromPath)) firstSeen.set(msnFromPath, ts);
        missionIdsFromLog.add(msnFromPath);
      }
    }

    if (
      msnFromSubject &&
      commitSubjectHasMsnPrefix(rec.subject, msnFromSubject) &&
      isTeacherEmail(rec.email) &&
      touchesMission
    ) {
      legislative++;
    }

    if (touchesWorkerLog && !touchesMission) worker_trace++;

    if (msnFromSubject) lastSeen.set(msnFromSubject, ts);
  }

  return {
    missionIdsFromLog,
    legislative,
    worker_trace,
    bypass_audit,
    firstSeen,
    lastSeen,
  };
}

export function computeTurnaround(
  firstSeen: Map<string, number>,
  lastSeen: Map<string, number>,
): { mean: number | null; median: number | null; samples: number } {
  const deltas: number[] = [];
  for (const [msn, end] of lastSeen) {
    const start = firstSeen.get(msn);
    if (start === undefined) continue;
    const delta = (end - start) / 1000;
    if (Number.isFinite(delta) && delta >= 0) deltas.push(delta);
  }
  if (deltas.length === 0) return { mean: null, median: null, samples: 0 };
  const sum = deltas.reduce((a, b) => a + b, 0);
  return { mean: sum / deltas.length, median: median(deltas), samples: deltas.length };
}
