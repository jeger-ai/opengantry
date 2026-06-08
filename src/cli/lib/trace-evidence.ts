import path from "node:path";
import { WORKER_LOG_FILENAME } from "./constants.js";
import { gitDiffNameOnlySinceCommit, gitRun } from "./git-repo.js";
import type { Manifest } from "./types.js";
import type { TraceRow } from "./types.js";
import {
  buildWorkerLogLineMapForQuotes,
  quoteLineNumbers,
  type WorkerLogLineMap,
} from "./worker-log-line-map.js";

export const UNCOMMITTED_BLAME_COMMIT = "0000000000000000000000000000000000000000";

export interface ResolvedQuoteLine {
  row: TraceRow;
  lineNumber: number;
}

export interface TraceEvidenceFailure {
  row: TraceRow;
  attestationCommit: string;
  quoteLine: number;
  stalePaths: string[];
  reason: string;
}

export interface TraceEvidenceOptions {
  skipStaleEvidence?: boolean;
}

function isPassStatus(status: string): boolean {
  return status.toUpperCase().includes("PASS");
}

function tmvcRootsForSkill(manifest: Manifest, skillKey: string | null): string[] {
  if (!skillKey?.trim()) return [];
  const skill = manifest.skills[skillKey];
  return skill ? [...skill.tmvc_roots] : [];
}

function workerLogRelPath(workerLogPath: string, repoRoot: string): string {
  const abs = path.resolve(workerLogPath);
  const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
  return rel.length > 0 && !rel.startsWith("..") ? rel : WORKER_LOG_FILENAME;
}

/** Parse `git blame --porcelain` into 1-based line number → commit hash. */
export function parseBlamePorcelainByLine(blameOutput: string): Map<number, string> {
  const byLine = new Map<number, string>();
  const lines = blameOutput.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const header = lines[i]!;
    const full = /^([0-9a-f]{40})\s+\d+\s+(\d+)\s+(\d+)/.exec(header);
    const short = /^([0-9a-f]{40})\s+\d+\s+(\d+)\s*$/.exec(header);
    if (!full && !short) {
      i += 1;
      continue;
    }
    const commit = (full ?? short)![1]!;
    const finalLine = parseInt((full ?? short)![2]!, 10);
    i += 1;
    if (full) {
      while (i < lines.length && !lines[i]!.startsWith("\t")) {
        i += 1;
      }
    }
    if (i < lines.length && lines[i]!.startsWith("\t")) {
      byLine.set(finalLine, commit);
      i += 1;
      continue;
    }
    if (short) {
      byLine.set(finalLine, commit);
    }
  }

  return byLine;
}

export function readBlamePorcelainByLine(repoRoot: string, workerLogRelPath: string): Map<number, string> {
  const r = gitRun(repoRoot, ["blame", "--porcelain", "--", workerLogRelPath]);
  if (!r.ok) return new Map();
  return parseBlamePorcelainByLine(r.stdout);
}

export function resolveQuoteLineNumber(
  map: WorkerLogLineMap,
  row: TraceRow,
  resolvedLineByDodId: ReadonlyMap<string, number>,
): number | null {
  const override = resolvedLineByDodId.get(row.dodId);
  if (override !== undefined) return override;

  const anchor = row.anchor.trim();
  if (/^\d+$/.test(anchor)) {
    const declared = parseInt(anchor, 10);
    const line = map.lines[declared - 1];
    if (line !== undefined && line.includes(row.traceQuote)) return declared;
    const matches = quoteLineNumbers(map, row.traceQuote);
    if (matches.length === 1) return matches[0]!;
    return null;
  }

  for (let i = 0; i < map.lines.length; i++) {
    const line = map.lines[i]!;
    if (line.includes(anchor) && line.includes(row.traceQuote)) return i + 1;
  }
  return null;
}

function formatStaleReason(
  row: TraceRow,
  quoteLine: number,
  attestationCommit: string,
  stalePaths: string[],
): string {
  const shortCommit = attestationCommit.slice(0, 7);
  const shown = stalePaths.slice(0, 5);
  const suffix =
    stalePaths.length > shown.length ? ` (+${String(stalePaths.length - shown.length)} more)` : "";
  return (
    `Trace STALE for DoD ${row.dodId} (WORKER_LOG.md line ${String(quoteLine)}, attested at ${shortCommit}): ` +
    `TMVC drift since attestation — ${shown.join(", ")}${suffix}. Re-run gate and append a fresh trace line.`
  );
}

export function verifyTraceEvidenceFreshness(
  repoRoot: string,
  manifest: Manifest,
  skillKey: string | null,
  workerLogPath: string,
  resolvedLines: ResolvedQuoteLine[],
  options: TraceEvidenceOptions = {},
): { failures: TraceEvidenceFailure[]; skippedUncommitted: number } {
  if (options.skipStaleEvidence === true) {
    return { failures: [], skippedUncommitted: 0 };
  }

  const tmvcRoots = tmvcRootsForSkill(manifest, skillKey);
  if (tmvcRoots.length === 0) {
    return { failures: [], skippedUncommitted: 0 };
  }

  const workerLogRel = workerLogRelPath(workerLogPath, repoRoot);
  const blameByLine = readBlamePorcelainByLine(repoRoot, workerLogRel);
  const diffCache = new Map<string, string[]>();
  const failures: TraceEvidenceFailure[] = [];
  let skippedUncommitted = 0;

  for (const { row, lineNumber } of resolvedLines) {
    const attestationCommit = blameByLine.get(lineNumber);
    if (!attestationCommit) {
      failures.push({
        row,
        attestationCommit: "unknown",
        quoteLine: lineNumber,
        stalePaths: [],
        reason: `Trace STALE for DoD ${row.dodId}: cannot resolve git blame for WORKER_LOG.md line ${String(lineNumber)}`,
      });
      continue;
    }

    if (attestationCommit === UNCOMMITTED_BLAME_COMMIT) {
      skippedUncommitted += 1;
      continue;
    }

    let stalePaths = diffCache.get(attestationCommit);
    if (stalePaths === undefined) {
      stalePaths = gitDiffNameOnlySinceCommit(repoRoot, attestationCommit, tmvcRoots);
      diffCache.set(attestationCommit, stalePaths);
    }

    if (stalePaths.length > 0) {
      failures.push({
        row,
        attestationCommit,
        quoteLine: lineNumber,
        stalePaths,
        reason: formatStaleReason(row, lineNumber, attestationCommit, stalePaths),
      });
    }
  }

  return { failures, skippedUncommitted };
}

/** Build resolved quote lines for PASS rows after trace quote mapping succeeded. */
export function resolvePassQuoteLines(
  workerLogPath: string,
  rows: TraceRow[],
  resolvedLineByDodId: ReadonlyMap<string, number> = new Map(),
): { resolved: ResolvedQuoteLine[]; map: WorkerLogLineMap | null } {
  const passRows = rows.filter((r) => isPassStatus(r.status));
  const quotes = passRows.map((r) => r.traceQuote);
  const map = buildWorkerLogLineMapForQuotes(workerLogPath, quotes);
  if (!map) return { resolved: [], map: null };

  const resolved: ResolvedQuoteLine[] = [];
  for (const row of passRows) {
    const lineNumber = resolveQuoteLineNumber(map, row, resolvedLineByDodId);
    if (lineNumber !== null) resolved.push({ row, lineNumber });
  }
  return { resolved, map };
}
