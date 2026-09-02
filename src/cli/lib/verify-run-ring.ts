import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { RemediationSnapshot } from "./context-feed-store.js";
import { GXT_ERROR } from "./gxt-error-codes.js";
import type { VerifyPhaseTiming } from "./verify-phase-clock.js";
import type { VerifyFinding } from "./verify-finding.js";
import { writeJsonAtomicSync, readJsonOrNull } from "./atomic-fs.js";

type RecordableVerifyResult =
  | { ok: true; proofMsnId: string; phaseTimings: VerifyPhaseTiming[] }
  | { ok: false; phaseTimings: VerifyPhaseTiming[] };

export const REL_VERIFY_RUNS_DIR = ".gitagent/tmp/verify-runs" as const;
export const VERIFY_RUN_RING_MAX = 20;
export const VERIFY_LAST_SCHEMA_VERSION = 1 as const;

export type VerifyLastOutcome = "PASS" | "FAIL" | "ABORT";

export interface VerifyLastSnapshot {
  schema_version: typeof VERIFY_LAST_SCHEMA_VERSION;
  written_at: string;
  msn_id?: string;
  mission_file_path?: string;
  outcome: VerifyLastOutcome;
  error_code?: string;
  message?: string;
  findings?: VerifyFinding[];
  findings_digest?: string;
  digest_ring: string[];
  gate_log_path?: string;
  phases: VerifyPhaseTiming[];
}

export interface VerifyRunRingEntry {
  id: string;
  written_at: string;
  msn_id?: string;
  outcome: VerifyLastOutcome;
  error_code?: string;
  findings_count: number;
  duration_ms_total: number;
}

/** Sortable run filename: 13-digit ms + 6-hex nonce. */
export const RUN_FILE = /^(\d{13}-[0-9a-f]{6})\.json$/;

function runsDir(repoRoot: string): string {
  return path.join(repoRoot, REL_VERIFY_RUNS_DIR);
}

function runFilePath(repoRoot: string, id: string): string {
  return path.join(runsDir(repoRoot), `${id}.json`);
}

function isValidRunId(id: string): boolean {
  return RUN_FILE.test(`${id}.json`);
}

function generateRunId(): string {
  return `${String(Date.now()).padStart(13, "0")}-${crypto.randomBytes(3).toString("hex")}`;
}

function unlinkQuiet(abs: string): void {
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch {
    // best-effort
  }
}

function isVerifyLastSnapshot(parsed: unknown): parsed is VerifyLastSnapshot {
  if (parsed === null || typeof parsed !== "object") return false;
  const o = parsed as VerifyLastSnapshot;
  return (
    o.schema_version === VERIFY_LAST_SCHEMA_VERSION &&
    typeof o.written_at === "string" &&
    typeof o.outcome === "string" &&
    Array.isArray(o.phases) &&
    Array.isArray(o.digest_ring)
  );
}

export function compactVerifyRunFromSnapshot(
  id: string,
  snapshot: VerifyLastSnapshot,
): VerifyRunRingEntry {
  const duration_ms_total = snapshot.phases.reduce((sum, p) => sum + p.duration_ms, 0);
  const entry: VerifyRunRingEntry = {
    id,
    written_at: snapshot.written_at,
    outcome: snapshot.outcome,
    findings_count: snapshot.findings?.length ?? 0,
    duration_ms_total,
  };
  if (snapshot.msn_id) entry.msn_id = snapshot.msn_id;
  if (snapshot.error_code) entry.error_code = snapshot.error_code;
  return entry;
}

function listRunIds(repoRoot: string): string[] {
  const dir = runsDir(repoRoot);
  if (!fs.existsSync(dir)) return [];
  try {
    return fs
      .readdirSync(dir)
      .map((name) => {
        const m = RUN_FILE.exec(name);
        return m?.[1] ?? null;
      })
      .filter((id): id is string => id !== null)
      .sort((a, b) => b.localeCompare(a));
  } catch {
    return [];
  }
}

function pruneOldRuns(repoRoot: string): void {
  const ids = listRunIds(repoRoot);
  for (const id of ids.slice(VERIFY_RUN_RING_MAX)) {
    unlinkQuiet(runFilePath(repoRoot, id));
  }
}

/** Never throws — corrupt files are skipped. */
export function listVerifyRuns(repoRoot: string): VerifyRunRingEntry[] {
  const ids = listRunIds(repoRoot).slice(0, VERIFY_RUN_RING_MAX);
  const entries: VerifyRunRingEntry[] = [];
  for (const id of ids) {
    const snapshot = readVerifyRunSnapshot(repoRoot, id);
    if (!snapshot) continue;
    entries.push(compactVerifyRunFromSnapshot(id, snapshot));
  }
  return entries;
}

export function appendVerifyRunRing(repoRoot: string, snapshot: VerifyLastSnapshot): string {
  const id = generateRunId();
  writeJsonAtomicSync(runFilePath(repoRoot, id), snapshot);
  pruneOldRuns(repoRoot);
  return id;
}

export function readVerifyRunSnapshot(repoRoot: string, id: string): VerifyLastSnapshot | null {
  if (!isValidRunId(id)) return null;
  return readJsonOrNull(runFilePath(repoRoot, id), isVerifyLastSnapshot);
}

export function readLatestVerifyRunSnapshot(repoRoot: string): VerifyLastSnapshot | null {
  const ids = listRunIds(repoRoot);
  if (ids.length === 0) return null;
  return readVerifyRunSnapshot(repoRoot, ids[0]!);
}

export function findLatestVerifyRunForMission(
  repoRoot: string,
  msnId: string,
): { id: string; snapshot: VerifyLastSnapshot } | null {
  for (const id of listRunIds(repoRoot)) {
    const snapshot = readVerifyRunSnapshot(repoRoot, id);
    if (snapshot?.msn_id === msnId) return { id, snapshot };
  }
  return null;
}

export function snapshotFromVerifyResult(
  result: RecordableVerifyResult,
  remediation: RemediationSnapshot | null,
): VerifyLastSnapshot | null {
  const phases = result.phaseTimings ?? [];
  const written_at = new Date().toISOString();
  if (result.ok) {
    const snapshot: VerifyLastSnapshot = {
      schema_version: VERIFY_LAST_SCHEMA_VERSION,
      written_at,
      outcome: "PASS",
      digest_ring: [],
      phases,
      msn_id: result.proofMsnId,
    };
    return snapshot;
  }
  if (!remediation) return null;
  const isAbort = remediation.error_code === GXT_ERROR.FINDINGS_RECURRED;
  return {
    schema_version: VERIFY_LAST_SCHEMA_VERSION,
    written_at,
    outcome: isAbort ? "ABORT" : "FAIL",
    msn_id: remediation.msn_id,
    mission_file_path: remediation.mission_file_path,
    error_code: remediation.error_code,
    message: remediation.message,
    findings: remediation.findings,
    findings_digest: remediation.findings_digest,
    digest_ring: remediation.digest_ring ?? [],
    gate_log_path: remediation.gate_log_path,
    phases,
  };
}

export function recordVerifyRunBestEffort(
  root: string,
  result: RecordableVerifyResult,
  remediation: RemediationSnapshot | null,
): void {
  const snapshot = snapshotFromVerifyResult(result, remediation);
  if (!snapshot) return;
  try {
    appendVerifyRunRing(root, snapshot);
  } catch {
    // Best-effort — verify must not fail because report snapshot I/O failed.
  }
}

/** @deprecated Use listVerifyRuns — kept for tests migrating from index.json. */
export function readVerifyRunRing(repoRoot: string): VerifyRunRingEntry[] {
  return listVerifyRuns(repoRoot);
}
