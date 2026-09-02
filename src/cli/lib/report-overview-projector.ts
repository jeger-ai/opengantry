import path from "node:path";
import {
  collectGitMetricsBundle,
  buildGxtExtensionMetadata,
  type GitMetricsBundle,
  type GitMetricsReport,
  type MissionTimelineEntry,
} from "./git-metrics.js";
import { loadManifest } from "./manifest.js";
import { MSN_ID_PATTERN } from "./constants.js";
import type { ReportOutcome } from "./report-template-shared.js";
import { buildStatusReport, type StatusReport } from "./status-report.js";
import {
  listVerifyRuns,
  readVerifyRunSnapshot,
  readLatestVerifyRunSnapshot,
  type VerifyLastOutcome,
  type VerifyLastSnapshot,
  type VerifyRunRingEntry,
} from "./verify-run-ring.js";

const BLOCKER_LIMIT = 5;

export interface OverviewLastVerify {
  outcome: ReportOutcome;
  msn_id: string;
  message: string;
  empty: boolean;
  href: "/verify";
}

export interface OverviewVerifyRun extends VerifyRunRingEntry {
  href: `/run/${string}`;
  summary: string;
  when: string;
  duration: string;
}

export interface OverviewTimelineRow extends MissionTimelineEntry {
  pinned: boolean;
  href: `/mission/${string}`;
  verify_status: VerifyLastOutcome | null;
}

export interface OverviewVerifyGlance {
  ring_total: number;
  ring_pass: number;
  ring_fail: number;
  ring_abort: number;
  last_failure: {
    msn_id: string;
    outcome: VerifyLastOutcome;
    summary: string;
    when: string;
    href: `/run/${string}`;
  } | null;
}

export interface OverviewViewModel {
  repo_name: string;
  schema_version: string;
  pinned_mission: string | null;
  verify_readiness: StatusReport["verify_readiness"] | "unknown";
  readiness_summary: string;
  blockers: string[];
  next_step: string | null;
  metrics: GitMetricsReport;
  verify_glance: OverviewVerifyGlance;
  timeline: OverviewTimelineRow[];
  verify_runs: OverviewVerifyRun[];
  last_verify: OverviewLastVerify;
}

function emptyGitBundle(): GitMetricsBundle {
  return {
    report: {
      ref: "HEAD",
      missions_completed: 0,
      bypass_count: 0,
      bypass_audit_commits: 0,
      legislative_commits: 0,
      worker_trace_commits: 0,
      turnaround_seconds: { mean: null, median: null, samples: 0 },
      mission_ids: [],
      gxt_extension_metadata: buildGxtExtensionMetadata(),
    },
    timeline: [],
  };
}

function loadGitBundle(root: string): GitMetricsBundle {
  try {
    return collectGitMetricsBundle(root, "HEAD");
  } catch {
    return emptyGitBundle();
  }
}

function msnFromPinned(pinned: string | null): string | null {
  if (!pinned) return null;
  const match = pinned.match(/MSN-\d{4}/);
  return match && MSN_ID_PATTERN.test(match[0]) ? match[0] : null;
}

export function formatVerifyRunWhen(writtenAt: string): string {
  const parsed = Date.parse(writtenAt);
  if (!Number.isFinite(parsed)) return writtenAt;
  return new Date(parsed).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

export function formatVerifyRunDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function verifyRunSummary(snapshot: VerifyLastSnapshot | null): string {
  if (snapshot?.message?.trim()) return snapshot.message.trim();
  if (snapshot?.error_code) return snapshot.error_code;
  if (snapshot?.outcome === "PASS") return "All gates passed";
  const count = snapshot?.findings?.length ?? 0;
  if (count > 0) return `${count} finding${count === 1 ? "" : "s"}`;
  return "—";
}

function loadStatusSubset(root: string): Pick<
  OverviewViewModel,
  "schema_version" | "pinned_mission" | "verify_readiness" | "readiness_summary" | "blockers" | "next_step"
> {
  try {
    const report = buildStatusReport(root, loadManifest(root));
    return {
      schema_version: report.schema_version,
      pinned_mission: report.pinned_mission,
      verify_readiness: report.verify_readiness,
      readiness_summary: report.readiness_summary,
      blockers: report.blockers.slice(0, BLOCKER_LIMIT),
      next_step: report.next_step,
    };
  } catch {
    return {
      schema_version: "—",
      pinned_mission: null,
      verify_readiness: "unknown",
      readiness_summary: "unknown",
      blockers: [],
      next_step: null,
    };
  }
}

function latestVerifyOutcomeByMission(runs: VerifyRunRingEntry[]): Map<string, VerifyLastOutcome> {
  const map = new Map<string, VerifyLastOutcome>();
  for (const run of runs) {
    if (run.msn_id && !map.has(run.msn_id)) map.set(run.msn_id, run.outcome);
  }
  return map;
}

function buildVerifyGlance(runs: OverviewVerifyRun[]): OverviewVerifyGlance {
  let ring_pass = 0;
  let ring_fail = 0;
  let ring_abort = 0;
  for (const run of runs) {
    if (run.outcome === "PASS") ring_pass += 1;
    else if (run.outcome === "FAIL") ring_fail += 1;
    else if (run.outcome === "ABORT") ring_abort += 1;
  }
  const lastFailure = runs.find((run) => run.outcome === "FAIL" || run.outcome === "ABORT");
  return {
    ring_total: runs.length,
    ring_pass,
    ring_fail,
    ring_abort,
    last_failure: lastFailure
      ? {
          msn_id: lastFailure.msn_id ?? "—",
          outcome: lastFailure.outcome,
          summary: lastFailure.summary,
          when: lastFailure.when,
          href: lastFailure.href,
        }
      : null,
  };
}

function buildLastVerify(
  runs: OverviewVerifyRun[],
  latestSnapshot: VerifyLastSnapshot | null,
): OverviewLastVerify {
  if (!latestSnapshot || runs.length === 0) {
    return {
      outcome: "EMPTY",
      msn_id: "—",
      message: "Run gantry verify, then refresh this page.",
      empty: true,
      href: "/verify",
    };
  }
  const head = runs[0]!;
  return {
    outcome: latestSnapshot.outcome,
    msn_id: latestSnapshot.msn_id ?? head.msn_id ?? "—",
    message: latestSnapshot.message ?? verifyRunSummary(latestSnapshot),
    empty: false,
    href: "/verify",
  };
}

export function projectOverviewViewModel(root: string): OverviewViewModel {
  const git = loadGitBundle(root);
  const status = loadStatusSubset(root);
  const pinnedMsn = msnFromPinned(status.pinned_mission);
  const verifyRuns = listVerifyRuns(root);
  const latestSnapshot = readLatestVerifyRunSnapshot(root);
  const latestByMission = latestVerifyOutcomeByMission(verifyRuns);
  const verify_runs = verifyRuns.map((run) => {
    const snapshot = readVerifyRunSnapshot(root, run.id);
    return {
      ...run,
      href: `/run/${run.id}` as const,
      when: formatVerifyRunWhen(run.written_at),
      duration: formatVerifyRunDuration(run.duration_ms_total),
      summary: verifyRunSummary(snapshot),
    };
  });
  return {
    repo_name: path.basename(root),
    schema_version: status.schema_version,
    pinned_mission: status.pinned_mission,
    verify_readiness: status.verify_readiness,
    readiness_summary: status.readiness_summary,
    blockers: status.blockers,
    next_step: status.next_step,
    metrics: git.report,
    verify_glance: buildVerifyGlance(verify_runs),
    timeline: git.timeline.map((row) => ({
      ...row,
      pinned: row.msn_id === pinnedMsn,
      href: `/mission/${row.msn_id}` as const,
      verify_status: latestByMission.get(row.msn_id) ?? null,
    })),
    verify_runs,
    last_verify: buildLastVerify(verify_runs, latestSnapshot),
  };
}
