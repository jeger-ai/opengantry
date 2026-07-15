import path from "node:path";
import { LEGISLATE_TRACE_PLACEHOLDER, EXECUTOR_LOG_FILENAME } from "./constants.js";
import { toPosixRel } from "./cli-io.js";
import { gitDiffNameOnlySinceCommit, gitRun, type GitDiffSinceCommitResult } from "./git.js";
import { quoteLineNumbers, type ExecutorLogLineMap, buildExecutorLogLineMapForQuotes } from "./executor-log-line-map.js";
import { tmvcRootsForSkill } from "./tmvc-path.js";
import type { Manifest, TraceRow } from "./types.js";

/** Normalized trace row status at mission boundary. */
export type NormalizedTraceStatus = "PASS" | "FAIL" | "PENDING";

export function normalizeTraceStatus(status: string): NormalizedTraceStatus {
  const upper = status.trim().toUpperCase();
  if (upper === "PASS") return "PASS";
  if (upper === "FAIL") return "FAIL";
  if (upper === "PENDING") return "PENDING";
  return "PENDING";
}

export function isPassStatus(status: NormalizedTraceStatus): boolean {
  return status === "PASS";
}

export function isPendingStatus(status: NormalizedTraceStatus): boolean {
  return status === "PENDING";
}



/** Typed trace verification failure — control flow must branch on this, not UI strings. */
export type TraceFailureKind =
  | "ambiguous"
  | "quote_missing"
  | "executor_log_missing"
  | "placeholder_quote"
  | "strict_line_drift"
  | "empty_quote"
  | "anchor_mismatch"
  | "stale_evidence"
  | "other";

function missingQuoteKind(traceQuote: string): TraceFailureKind {
  return traceQuote.trim() === LEGISLATE_TRACE_PLACEHOLDER ? "placeholder_quote" : "quote_missing";
}

export const UNCOMMITTED_BLAME_COMMIT = "0000000000000000000000000000000000000000";

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

function executorLogRelPath(executorLogPath: string, repoRoot: string): string {
  const abs = path.resolve(executorLogPath);
  const rel = toPosixRel(repoRoot, abs);
  return rel.length > 0 && !rel.startsWith("..") ? rel : EXECUTOR_LOG_FILENAME;
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

export function readBlamePorcelainByLine(repoRoot: string, executorLogRelPath: string): Map<number, string> {
  const r = gitRun(repoRoot, ["blame", "--porcelain", "--", executorLogRelPath]);
  if (!r.ok) return new Map();
  return parseBlamePorcelainByLine(r.stdout);
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
    `Trace STALE for DoD ${row.dodId} (EXECUTOR_LOG.md line ${String(quoteLine)}, attested at ${shortCommit}): ` +
    `TMVC drift since attestation — ${shown.join(", ")}${suffix}. Re-run gate and append a fresh trace line.`
  );
}

export function verifyTraceEvidenceFreshness(
  repoRoot: string,
  manifest: Manifest,
  skillKey: string | null,
  executorLogPath: string,
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

  const executorLogRel = executorLogRelPath(executorLogPath, repoRoot);
  const blameByLine = readBlamePorcelainByLine(repoRoot, executorLogRel);
  const diffCache = new Map<string, GitDiffSinceCommitResult>();
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
        reason: `Trace STALE for DoD ${row.dodId}: cannot resolve git blame for EXECUTOR_LOG.md line ${String(lineNumber)}`,
      });
      continue;
    }

    if (attestationCommit === UNCOMMITTED_BLAME_COMMIT) {
      skippedUncommitted += 1;
      continue;
    }

    let diffResult = diffCache.get(attestationCommit);
    if (diffResult === undefined) {
      diffResult = gitDiffNameOnlySinceCommit(repoRoot, attestationCommit, tmvcRoots);
      diffCache.set(attestationCommit, diffResult);
    }

    if (!diffResult.ok) {
      failures.push({
        row,
        attestationCommit,
        quoteLine: lineNumber,
        stalePaths: [],
        reason: `Trace STALE for DoD ${row.dodId}: cannot evaluate TMVC drift since attestation (git diff failed)`,
      });
      continue;
    }

    if (diffResult.paths.length > 0) {
      failures.push({
        row,
        attestationCommit,
        quoteLine: lineNumber,
        stalePaths: diffResult.paths,
        reason: formatStaleReason(row, lineNumber, attestationCommit, diffResult.paths),
      });
    }
  }

  return { failures, skippedUncommitted };
}

export interface TraceVerifyFailure {
  row: TraceRow;
  /** Set at construction — every failure site knows its own kind. */
  kind: TraceFailureKind;
  reason: string;
}

export interface TraceVerifyWarning {
  row: TraceRow;
  declaredLine: number;
  foundLine: number;
  autoResolved?: boolean;
}

export interface TraceVerifyOptions {
  /** Force fuzzy for all numeric anchors. */
  fuzzyNumericAnchor?: boolean;
  /** Disable auto-retry on line drift only. */
  strictTrace?: boolean;
}

export interface ResolvedQuoteLine {
  row: TraceRow;
  lineNumber: number;
}

export interface TraceVerifyResult {
  failures: TraceVerifyFailure[];
  warnings: TraceVerifyWarning[];
  resolvedLines: ResolvedQuoteLine[];
  map: ExecutorLogLineMap | null;
}

export function isPassTraceRow(status: string): boolean {
  return isPassStatus(normalizeTraceStatus(status));
}

export function resolveQuoteLineNumber(
  map: ExecutorLogLineMap,
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

function buildResolvedQuoteLines(
  passRows: TraceRow[],
  map: ExecutorLogLineMap,
  warnings: TraceVerifyWarning[],
): ResolvedQuoteLine[] {
  const resolvedLineByDodId = new Map<string, number>();
  for (const warning of warnings) {
    resolvedLineByDodId.set(warning.row.dodId, warning.foundLine);
  }
  const resolved: ResolvedQuoteLine[] = [];
  for (const row of passRows) {
    const lineNumber = resolveQuoteLineNumber(map, row, resolvedLineByDodId);
    if (lineNumber !== null) resolved.push({ row, lineNumber });
  }
  return resolved;
}

function verifyNumericAnchorExact(
  map: ExecutorLogLineMap,
  row: TraceRow,
  lineNumber: number,
): TraceVerifyFailure | null {
  const line = map.lines[lineNumber - 1];
  if (line === undefined) {
    return {
      row,
      kind: "strict_line_drift",
      reason: `Anchor line ${lineNumber} out of range (file has ${map.lines.length} lines)`,
    };
  }
  if (!line.includes(row.traceQuote)) {
    return { row, kind: "strict_line_drift", reason: `Trace quote not on anchored line ${lineNumber}` };
  }
  return null;
}

function resolveDriftFromMap(
  map: ExecutorLogLineMap,
  row: TraceRow,
  lineNumber: number,
): { failure: TraceVerifyFailure | null; warning: TraceVerifyWarning | null } {
  const matches = quoteLineNumbers(map, row.traceQuote);
  if (matches.length === 0) {
    return {
      failure: {
        row,
        kind: missingQuoteKind(row.traceQuote),
        reason: "Trace quote not found verbatim in EXECUTOR_LOG.md",
      },
      warning: null,
    };
  }
  if (matches.length === 1) {
    const foundLine = matches[0]!;
    return {
      failure: null,
      warning: { row, declaredLine: lineNumber, foundLine, autoResolved: true },
    };
  }
  return {
    failure: {
      row,
      kind: "ambiguous",
      reason: `Ambiguous trace quote: found on lines ${matches.join(", ")}; re-run a clean flight`,
    },
    warning: null,
  };
}

function verifyNumericAnchorFuzzy(
  map: ExecutorLogLineMap,
  row: TraceRow,
  lineNumber: number,
): { failure: TraceVerifyFailure | null; warning: TraceVerifyWarning | null } {
  const exact = verifyNumericAnchorExact(map, row, lineNumber);
  if (exact === null) return { failure: null, warning: null };
  return resolveDriftFromMap(map, row, lineNumber);
}

function verifyFreeformAnchor(map: ExecutorLogLineMap, row: TraceRow, anchor: string): TraceVerifyFailure | null {
  const found = map.lines.some((line) => line.includes(anchor) && line.includes(row.traceQuote));
  if (!found) {
    return {
      row,
      kind: "anchor_mismatch",
      reason: `No line contains both anchor "${anchor}" and trace quote`,
    };
  }
  return null;
}

/** Line numbers are 1-based in mission table; other anchors match a substring on a line */
export function verifyTraceRows(
  executorLogPath: string,
  rows: TraceRow[],
  options: TraceVerifyOptions = {},
): TraceVerifyResult {
  const forceFuzzy = options.fuzzyNumericAnchor === true;
  const autoFuzzy = options.strictTrace !== true;
  const passRows = rows.filter((r) => isPassTraceRow(r.status));

  const quotes = passRows.map((r) => r.traceQuote);
  const map = buildExecutorLogLineMapForQuotes(executorLogPath, quotes);

  if (!map) {
    return {
      failures: passRows.map((row) => ({
        row,
        kind: "executor_log_missing" as const,
        reason: `EXECUTOR_LOG missing: ${executorLogPath}`,
      })),
      warnings: [],
      resolvedLines: [],
      map: null,
    };
  }

  const failures: TraceVerifyFailure[] = [];
  const warnings: TraceVerifyWarning[] = [];

  for (const row of passRows) {
    if (!row.traceQuote.trim()) {
      failures.push({ row, kind: "empty_quote", reason: "PASS row has empty trace quote" });
      continue;
    }
    if (!map.content.includes(row.traceQuote)) {
      failures.push({
        row,
        kind: missingQuoteKind(row.traceQuote),
        reason: "Trace quote not found verbatim in EXECUTOR_LOG.md",
      });
      continue;
    }

    const anchor = row.anchor.trim();
    if (/^\d+$/.test(anchor)) {
      const lineNumber = parseInt(anchor, 10);
      if (forceFuzzy) {
        const { failure, warning } = verifyNumericAnchorFuzzy(map, row, lineNumber);
        if (failure) failures.push(failure);
        else if (warning) warnings.push(warning);
        continue;
      }

      const exactFailure = verifyNumericAnchorExact(map, row, lineNumber);
      if (exactFailure === null) continue;

      // Exact numeric-anchor failures are always line drift; auto-fuzzy retries them.
      if (autoFuzzy) {
        const { failure, warning } = resolveDriftFromMap(map, row, lineNumber);
        if (failure) failures.push(failure);
        else if (warning) warnings.push(warning);
      } else {
        failures.push(exactFailure);
      }
      continue;
    }

    const failure = verifyFreeformAnchor(map, row, anchor);
    if (failure) failures.push(failure);
  }

  return {
    failures,
    warnings,
    resolvedLines: buildResolvedQuoteLines(passRows, map, warnings),
    map,
  };
}

export function defaultExecutorLogPath(repoRoot: string): string {
  return path.join(repoRoot, EXECUTOR_LOG_FILENAME);
}
