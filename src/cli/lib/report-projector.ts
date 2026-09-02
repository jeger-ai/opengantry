import fs from "node:fs";
import path from "node:path";
import type { ReportOutcome } from "./report-template-shared.js";
import {
  findLatestVerifyRunForMission,
  listVerifyRuns,
  readLatestVerifyRunSnapshot,
  readVerifyRunSnapshot,
  type VerifyLastSnapshot,
} from "./verify-run-ring.js";
import type { VerifyPhaseTiming } from "./verify-phase-clock.js";
import type { VerifyFinding } from "./verify-finding.js";

export type { ReportOutcome };

export interface ReportDonutBuckets {
  kpi: number;
  error: number;
  warning: number;
}

export interface ReportPhaseBar {
  id: string;
  duration_ms: number;
  status: string;
  bar_pct: number;
}

export interface ReportFindingCard {
  failed_gate: string;
  rule_id: string;
  location: string;
  resolution_hint: string;
  evidence: string;
  fingerprint: string;
  semantic_fingerprint: string;
}

export interface ReportViewModel {
  outcome: ReportOutcome;
  msn_id: string;
  mission_file_path: string;
  error_code: string;
  message: string;
  findings_digest: string;
  digest_ring: string[];
  ring_highlight: boolean;
  ring_recurrence_count: number;
  gate_log_path: string;
  has_log: boolean;
  log_href: string;
  back_href: string;
  run_id: string;
  written_at: string;
  phases: ReportPhaseBar[];
  donut: { buckets: ReportDonutBuckets; conic: string };
  findings: ReportFindingCard[];
  empty: boolean;
}

const DONUT_COLORS = {
  kpi: "#c9a227",
  error: "#e5534b",
  warning: "#d29922",
  muted: "#3d444d",
} as const;

function formatLocation(finding: VerifyFinding): string {
  const file = finding.offending_file || "(unknown)";
  const startCol = finding.start_column ?? 0;
  const endLine = finding.end_line ?? finding.line;
  const endCol = finding.end_column ?? 0;
  if (finding.line > 0) {
    return `${file}:[${finding.line}:${startCol} - ${endLine}:${endCol}]`;
  }
  return file;
}

function classifyFinding(finding: VerifyFinding): keyof ReportDonutBuckets {
  if (finding.failed_gate === "kpi") return "kpi";
  return finding.severity === "warning" ? "warning" : "error";
}

export function buildDonutBuckets(findings: VerifyFinding[]): ReportDonutBuckets {
  const buckets: ReportDonutBuckets = { kpi: 0, error: 0, warning: 0 };
  for (const f of findings) {
    buckets[classifyFinding(f)] += 1;
  }
  return buckets;
}

export function buildConicGradient(buckets: ReportDonutBuckets): string {
  const total = buckets.kpi + buckets.error + buckets.warning;
  if (total === 0) return `${DONUT_COLORS.muted} 0% 100%`;
  let pct = 0;
  const stops: string[] = [];
  const entries: Array<[keyof ReportDonutBuckets, string]> = [
    ["kpi", DONUT_COLORS.kpi],
    ["error", DONUT_COLORS.error],
    ["warning", DONUT_COLORS.warning],
  ];
  for (const [key, color] of entries) {
    const count = buckets[key];
    if (count === 0) continue;
    const slice = (count / total) * 100;
    const start = pct;
    pct += slice;
    stops.push(`${color} ${start}% ${pct}%`);
  }
  return stops.join(", ");
}

export function buildPhaseBars(phases: VerifyPhaseTiming[]): ReportPhaseBar[] {
  const max = Math.max(0, ...phases.map((p) => p.duration_ms));
  return phases.map((p) => ({
    id: p.id,
    duration_ms: p.duration_ms,
    status: p.status,
    bar_pct: max > 0 ? Math.round((p.duration_ms / max) * 100) : 0,
  }));
}

function findingToCard(finding: VerifyFinding): ReportFindingCard {
  return {
    failed_gate: finding.failed_gate,
    rule_id: finding.rule_id ?? "—",
    location: formatLocation(finding),
    resolution_hint: finding.resolution_hint,
    evidence: finding.evidence ?? "",
    fingerprint: finding.fingerprint,
    semantic_fingerprint: finding.semantic_fingerprint,
  };
}

function ringRecurrenceCount(ring: string[], digest: string): number {
  if (!digest) return 0;
  return ring.filter((d) => d === digest).length;
}

export interface ReportViewOptions {
  log_href?: string;
  back_href?: string;
  run_id?: string;
}

function buildFromSnapshot(
  root: string,
  snapshot: VerifyLastSnapshot,
  options: ReportViewOptions = {},
): ReportViewModel {
  const findings = snapshot.findings ?? [];
  const digest = snapshot.findings_digest ?? "";
  const ring = snapshot.digest_ring ?? [];
  const buckets = buildDonutBuckets(findings);
  const gateLog = snapshot.gate_log_path ?? "";
  const logAbs = gateLog ? path.join(root, gateLog) : "";
  const runId = options.run_id ?? "";
  const logHref = options.log_href ?? (runId ? `/log?run=${encodeURIComponent(runId)}` : "/log");
  return {
    outcome: snapshot.outcome,
    msn_id: snapshot.msn_id ?? "—",
    mission_file_path: snapshot.mission_file_path ?? "—",
    error_code: snapshot.error_code ?? "",
    message: snapshot.message ?? "",
    findings_digest: digest,
    digest_ring: ring.slice(-4),
    ring_highlight: digest.length > 0 && ring.includes(digest),
    ring_recurrence_count: ringRecurrenceCount(ring, digest),
    gate_log_path: gateLog,
    has_log: Boolean(gateLog && fs.existsSync(logAbs)),
    log_href: logHref,
    back_href: options.back_href ?? "/",
    run_id: runId,
    written_at: snapshot.written_at,
    phases: buildPhaseBars(snapshot.phases),
    donut: { buckets, conic: buildConicGradient(buckets) },
    findings: findings.map(findingToCard),
    empty: false,
  };
}

function emptyViewModel(partial: Partial<ReportViewModel> = {}): ReportViewModel {
  return {
    outcome: "EMPTY",
    msn_id: "—",
    mission_file_path: "—",
    error_code: "",
    message: "Run gantry verify, then refresh this page.",
    findings_digest: "",
    digest_ring: [],
    ring_highlight: false,
    ring_recurrence_count: 0,
    gate_log_path: "",
    has_log: false,
    log_href: "/log",
    back_href: "/",
    run_id: "",
    written_at: "",
    phases: [],
    donut: { buckets: { kpi: 0, error: 0, warning: 0 }, conic: `${DONUT_COLORS.muted} 0% 100%` },
    findings: [],
    empty: true,
    ...partial,
  };
}

export function projectReportViewModel(root: string): ReportViewModel {
  const last = readLatestVerifyRunSnapshot(root);
  if (last) {
    const runs = listVerifyRuns(root);
    const runId = runs[0]?.id ?? "";
    return buildFromSnapshot(root, last, { back_href: "/", run_id: runId });
  }
  return emptyViewModel();
}

export function projectReportViewModelForRunId(root: string, runId: string): ReportViewModel | null {
  const snapshot = readVerifyRunSnapshot(root, runId);
  if (!snapshot) return null;
  return buildFromSnapshot(root, snapshot, {
    run_id: runId,
    back_href: "/",
  });
}

export function projectReportViewModelForMission(root: string, msnId: string): ReportViewModel {
  const hit = findLatestVerifyRunForMission(root, msnId);
  if (hit) {
    return buildFromSnapshot(root, hit.snapshot, {
      run_id: hit.id,
      back_href: "/",
    });
  }
  return emptyViewModel({
    msn_id: msnId,
    message: `No local verify snapshot for ${msnId} in the verify-run ring on this machine.`,
    back_href: "/",
  });
}
