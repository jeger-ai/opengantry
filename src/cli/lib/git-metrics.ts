import { gitRevParse } from "./git-repo.js";
import { listMissionMsnIdsAtRef } from "./git-metrics-missions.js";
import {
  aggregateFromLogStream,
  clearMetricsDiffCache,
  computeTurnaround,
  countBypassNotes,
  streamLogRecords,
} from "./git-metrics-stream.js";

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
}

/** Stable key order for cross-clone identical JSON. */
export function collectGitMetrics(root: string, refName: string): GitMetricsReport {
  clearMetricsDiffCache();
  const ref = gitRevParse(root, refName);
  if (!ref) throw new Error(`gapman metrics: invalid ref ${refName}`);
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
  };
}

export function formatGitMetricsHuman(report: GitMetricsReport): string {
  const lines = [
    `GXT metrics (ref ${report.ref})`,
    `  missions_completed: ${String(report.missions_completed)}`,
    `  bypass_count (git notes): ${String(report.bypass_count)}`,
    `  bypass_audit_commits: ${String(report.bypass_audit_commits)}`,
    `  legislative_commits (proxy): ${String(report.legislative_commits)}`,
    `  worker_trace_commits (proxy): ${String(report.worker_trace_commits)}`,
    `  turnaround_seconds.mean: ${report.turnaround_seconds.mean === null ? "n/a" : report.turnaround_seconds.mean.toFixed(1)}`,
    `  turnaround_seconds.median: ${report.turnaround_seconds.median === null ? "n/a" : report.turnaround_seconds.median.toFixed(1)}`,
    `  turnaround_seconds.samples: ${String(report.turnaround_seconds.samples)}`,
  ];
  return lines.join("\n");
}
