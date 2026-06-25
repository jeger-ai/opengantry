import YAML from "yaml";
import { GXT_BYPASS_NOTES_REF } from "./break-glass.js";
import { MSN_ID_PATTERN, WORKER_LOG_FILENAME } from "./constants.js";
import { parseTeacherEmailsFromEnv, commitSubjectHasMsnPrefix } from "./git-proof.js";
import { gitRevParse, gitRunOk } from "./git.js";

const MISSIONS_PREFIX = ".gitagent/missions/";

const diffCache = new Map<string, string[]>();

export interface LogRecord {
  hash: string;
  subject: string;
  email: string;
  ts: string;
}

/** Namespaced extension block for additive metrics semantics (strict-parser safe). */
export const GXT_METRICS_CLASSIFICATION_MODE = "PATH_TOUCH_PROXY" as const;
export const GXT_METRICS_EXTENSION_SCHEMA_VERSION = 1 as const;

export interface GxtExtensionMetadata {
  classification_mode: typeof GXT_METRICS_CLASSIFICATION_MODE;
  schema_version: typeof GXT_METRICS_EXTENSION_SCHEMA_VERSION;
}

export interface GitMetricsReport {
  ref: string;
  missions_completed: number;
  bypass_count: number;
  bypass_audit_commits: number;
  legislative_commits: number;
  worker_trace_commits: number;
  turnaround_seconds: {
    mean: number | null;
    median: number | null;
    samples: number;
  };
  mission_ids: string[];
  gxt_extension_metadata: GxtExtensionMetadata;
}

export function buildGxtExtensionMetadata(): GxtExtensionMetadata {
  return {
    classification_mode: GXT_METRICS_CLASSIFICATION_MODE,
    schema_version: GXT_METRICS_EXTENSION_SCHEMA_VERSION,
  };
}

function parseMsnFromYamlContent(content: string): string | null {
  try {
    const data = YAML.parse(content) as { msn_id?: string; msnId?: string };
    const raw = data.msn_id ?? data.msnId;
    if (typeof raw === "string" && MSN_ID_PATTERN.test(raw.trim())) return raw.trim();
  } catch {
    /* skip */
  }
  return null;
}

export function msnFromMissionPath(rel: string): string | null {
  const norm = rel.trim().replace(/\\/g, "/");
  if (!norm.startsWith(MISSIONS_PREFIX)) return null;
  if (!/\.(ya?ml|md)$/i.test(norm)) return null;
  const fromName = norm.match(/MSN-\d{4}/)?.[0];
  if (fromName && MSN_ID_PATTERN.test(fromName)) return fromName;
  return null;
}

export function listMissionMsnIdsAtRef(root: string, ref: string): Set<string> {
  const ids = new Set<string>();
  const tree = gitRunOk(root, ["ls-tree", "-r", "--name-only", ref, MISSIONS_PREFIX]);
  if (!tree.ok) return ids;

  for (const rel of tree.stdout.split("\n")) {
    const norm = rel.trim().replace(/\\/g, "/");
    if (!norm) continue;
    const fromName = msnFromMissionPath(norm);
    if (fromName) {
      ids.add(fromName);
      continue;
    }
    const show = gitRunOk(root, ["show", `${ref}:${norm}`]);
    if (!show.ok) continue;
    const parsed = parseMsnFromYamlContent(show.stdout);
    if (parsed) ids.add(parsed);
  }
  return ids;
}

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
  const normalizedAuthor = email.trim().toLowerCase();
  if (!normalizedAuthor) return false;

  const allow = parseTeacherEmailsFromEnv();
  if (allow.length === 0) return false;

  return allow.some(
    (teacherEmail) => teacherEmail.length > 0 && teacherEmail === normalizedAuthor,
  );
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

    const isLegislative =
      msnFromSubject !== null &&
      commitSubjectHasMsnPrefix(rec.subject, msnFromSubject) &&
      isTeacherEmail(rec.email) &&
      touchesMission;

    if (isLegislative) {
      legislative++;
    } else if (touchesWorkerLog && !touchesMission) {
      worker_trace++;
    }

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

/** Stable key order for cross-clone identical JSON. */
export function collectGitMetrics(root: string, refName: string): GitMetricsReport {
  clearMetricsDiffCache();
  const ref = gitRevParse(root, refName);
  if (!ref) throw new Error(`gantry metrics: invalid ref ${refName}`);
  const records = streamLogRecords(root, ref);
  const stream = aggregateFromLogStream(root, records);
  const fromMissions = listMissionMsnIdsAtRef(root, ref);
  const missionIds = [...new Set([...fromMissions, ...stream.missionIdsFromLog])].sort();

  return {
    ref,
    missions_completed: missionIds.length,
    bypass_count: countBypassNotes(root),
    bypass_audit_commits: stream.bypass_audit,
    legislative_commits: stream.legislative,
    worker_trace_commits: stream.worker_trace,
    turnaround_seconds: computeTurnaround(stream.firstSeen, stream.lastSeen),
    mission_ids: missionIds,
    gxt_extension_metadata: buildGxtExtensionMetadata(),
  };
}

export function formatGitMetricsHuman(report: GitMetricsReport): string {
  const lines = [
    `GXT metrics (ref ${report.ref})`,
    `  missions_completed: ${String(report.missions_completed)}`,
    `  bypass_count (git notes): ${String(report.bypass_count)}`,
    `  bypass_audit_commits: ${String(report.bypass_audit_commits)}`,
    `  classification_mode: ${report.gxt_extension_metadata.classification_mode}`,
    `  legislative_commits (proxy): ${String(report.legislative_commits)}`,
    `  worker_trace_commits (proxy): ${String(report.worker_trace_commits)}`,
    `  turnaround_seconds.mean: ${report.turnaround_seconds.mean === null ? "n/a" : report.turnaround_seconds.mean.toFixed(1)}`,
    `  turnaround_seconds.median: ${report.turnaround_seconds.median === null ? "n/a" : report.turnaround_seconds.median.toFixed(1)}`,
    `  turnaround_seconds.samples: ${String(report.turnaround_seconds.samples)}`,
  ];
  return lines.join("\n");
}
