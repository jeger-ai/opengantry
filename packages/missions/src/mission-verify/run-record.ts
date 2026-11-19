/**
 * Run-record phase (ADR-0052 A4, A5; RULES §3). A mission without trace rows is judged by `.gitagent/runs/<MSN>.json`,
 * which `gantry verify --record` writes after a full pass on a clean, committed tree. This loader supplies the git facts;
 * the judgement is `evaluateRunRecord` in core.
 */
import fs from "node:fs";
import path from "node:path";
import { canonicalJson } from "#core/canonical-json.js";
import { REL_RUNS_DIR } from "#core/constants.js";
import { evaluateRunRecord, RUN_RECORD_SCHEMA, sha256Hex, type RunRecord, type RunRecordAdmissionJournal } from "#core/run-record.js";
import { ADMISSION_JOURNAL_GENESIS } from "#core/admission-journal.js";
import { ADMISSION_JOURNAL_REL, admissionJournalPath, readAdmissionJournalFile } from "../admission/journal-file.js";
import { BrokerSetupError, brokerStateDir } from "../admission/serve.js";
import { gitDiffNameOnlySinceCommit, gitRevParse, gitRunOk } from "#git/git.js";
import { resolveEffectiveScopeForMission } from "../contract/effective-scope.js";
import { GantryUserError } from "#core/user-error.js";
import { formatRepoRelative } from "#core/posix-path.js";
import type { RunRecordFailure } from "./failure.js";
import type { PhaseContext } from "./phase-steps.js";

/** `notes`: labels a passing result must show, such as an admission journal anchor not verified here. */
type RunRecordPhaseOutcome = { kind: "ok"; recordPath: string; notes: string[] } | { kind: "fail"; failure: RunRecordFailure };

export function runRecordRelPath(msnId: string): string {
  return `${REL_RUNS_DIR}/${msnId}.json`;
}

/** The mission's committed run record, or null when it has none; an unparseable record reads as an invalid one. */
export function missionRunRecord(root: string, msnId: string | null): RunRecord | null {
  return msnId === null ? null : readRunRecord(root, runRecordRelPath(msnId));
}

function readRunRecord(root: string, rel: string): RunRecord | null {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8")) as RunRecord;
  } catch {
    return { schema: "invalid" } as unknown as RunRecord;
  }
}

/** The law the checks enforced: scope, gate and the sealed contract. A change to any of it invalidates the record. */
function missionLawSha256(ctx: PhaseContext): string {
  const scope = resolveEffectiveScopeForMission(ctx.root, ctx.manifest, ctx.mission);
  return sha256Hex(
    canonicalJson({
      tmvc_roots: scope.tmvcRoots,
      forbidden_zones: scope.forbiddenZones,
      gate_command: ctx.mission.gate?.command ?? null,
      gate_success_substring: ctx.mission.gate?.successSubstring ?? null,
      gate_adapter: ctx.mission.gate?.adapter ?? null,
      contract_sha256: ctx.mission.contractSha256,
    }),
  );
}

function headIsAncestor(root: string, head: string): boolean {
  return gitRunOk(root, ["merge-base", "--is-ancestor", head, "HEAD"]).ok;
}

/** Working-tree and committed changes under the mission's roots since the record head, the record itself excluded. */
function changedSinceHead(ctx: PhaseContext, head: string, recordRel: string): string[] {
  const scope = resolveEffectiveScopeForMission(ctx.root, ctx.manifest, ctx.mission);
  const diff = gitDiffNameOnlySinceCommit(ctx.root, head, scope.tmvcRoots);
  if (!diff.ok) return [`(git diff failed: ${diff.stderr.trim()})`];
  return diff.paths.filter((p) => p !== recordRel);
}

/** What this host shows about admission for the repository: its admission dir and journal, and a broker's state dir. */
type LocalAdmission =
  | { kind: "error"; problem: string }
  | { kind: "ok"; file: string; admissionDir: boolean; journal: boolean; brokerStateDir: string | null };

/** Whether `p` exists (lstat, never followed). Only ENOENT means absent: any other error (EACCES) throws. */
function present(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

const errText = (err: unknown): string => (err as NodeJS.ErrnoException).code ?? (err instanceof Error ? err.message : String(err));

/**
 * The broker state dir that shows a broker served this repository on this host, or null. Both the default
 * `~/.opengantry` and a `GANTRY_STATE_DIR` set now are checked, so an override cannot hide the default. A location
 * `serve` itself refuses (a relative or in-repository state dir) cannot have served it and is skipped; any other error
 * (EACCES) throws.
 */
function brokerServedHere(root: string, gitDir: string): string | null {
  const envs: NodeJS.ProcessEnv[] = [{ ...process.env, GANTRY_STATE_DIR: "" }];
  if (process.env.GANTRY_STATE_DIR?.trim()) envs.push(process.env);
  for (const env of envs) {
    let dir: string;
    try {
      dir = brokerStateDir(root, gitDir, env);
    } catch (err) {
      if (err instanceof BrokerSetupError) continue;
      throw err;
    }
    if (present(dir)) return dir;
  }
  return null;
}

function localAdmission(root: string): LocalAdmission {
  const file = admissionJournalPath(root);
  if (file === null) return { kind: "error", problem: "not a git repository" };
  const dir = path.dirname(file);
  try {
    const admissionDir = present(dir);
    const journal = admissionDir && present(file);
    return { kind: "ok", file, admissionDir, journal, brokerStateDir: brokerServedHere(root, path.dirname(path.dirname(dir))) };
  } catch (err) {
    return { kind: "error", problem: `the admission journal or the broker state for this repository cannot be checked (${errText(err)}); only a missing file means absent` };
  }
}

/**
 * The admission journal's anchor for a new run record (ADR-0063 owner decision Q6), or undefined when this host shows no
 * admission for the repository. Where an admission dir or a broker's state dir exists but nothing was journaled, the
 * anchor names zero records, so a record without an anchor always means "no admission here". A journal that does not
 * verify refuses the record: an anchor is never bound to a damaged journal.
 */
export function admissionJournalAnchorForRecord(root: string): RunRecordAdmissionJournal | undefined {
  const local = localAdmission(root);
  if (local.kind === "error") throw new GantryUserError("GXT_ADMISSION_JOURNAL_INVALID", `gantry verify --record: ${local.problem}`, "Fix the permissions; a run record is not written while the admission state cannot be read.", 1);
  if (!local.journal) return local.admissionDir || local.brokerStateDir !== null ? { path: ADMISSION_JOURNAL_REL, count: 0, head_digest: ADMISSION_JOURNAL_GENESIS } : undefined;
  const read = readAdmissionJournalFile(local.file);
  if (!read.exists) return { path: ADMISSION_JOURNAL_REL, count: 0, head_digest: ADMISSION_JOURNAL_GENESIS };
  if (!read.verdict.ok) {
    const v = read.verdict;
    throw new GantryUserError("GXT_ADMISSION_JOURNAL_INVALID", `gantry verify --record: the admission journal ${local.file} does not verify (${v.problem} at record ${v.index}: ${v.detail})`, "Keep the journal for the investigation; a run record is not written over a damaged journal.", 1);
  }
  return { path: ADMISSION_JOURNAL_REL, count: read.verdict.count, head_digest: read.verdict.headDigest };
}

/** How a record's admission journal anchor was judged here. */
export type AdmissionJournalCheck =
  | { status: "verified" }
  | { status: "not_verified_here"; detail: string }
  | { status: "mismatch"; problem: string };

const ANCHOR_KEYS = ["count", "head_digest", "path"];

/** The anchor's own shape, strictly: exactly `path` (the journal path), a non-negative integer `count` and a sha256 `head_digest`. */
function anchorFormatProblem(field: unknown): string | null {
  const f = field as Partial<RunRecordAdmissionJournal> | null;
  if (typeof f !== "object" || f === null || Array.isArray(f)) return "the record's admission_journal field is malformed";
  if (Object.keys(f).sort().join(",") !== ANCHOR_KEYS.join(",")) return "the record's admission_journal field is malformed (it must hold exactly path, count and head_digest)";
  if (f.path !== ADMISSION_JOURNAL_REL || !Number.isSafeInteger(f.count) || (f.count as number) < 0 || typeof f.head_digest !== "string" || !/^[0-9a-f]{64}$/.test(f.head_digest)) {
    return "the record's admission_journal field is malformed";
  }
  return null;
}

/**
 * Judge a record's admission journal anchor (ADR-0063 owner decisions Q6 and (a), 2026-11-17; PR #370 review round 2).
 * - The anchor's format is always checked strictly; a malformed one fails.
 * - Only a missing file means absent: an admission dir or state dir that cannot be read (EACCES) fails.
 * - Where the journal exists, the full chain is checked: a cut at or before the anchor, a rewrite, or a missing
 *   `journal.jsonl` in an existing admission dir fails. Records appended after the anchor are fine.
 * - Where the whole admission dir is absent (a CI clone, another machine), the chain cannot be checked: the result is
 *   `not_verified_here`, which a passing verify must show; it is never reported as verified. If this user's state dir
 *   (the default `~/.opengantry` or a `GANTRY_STATE_DIR` set now) shows a broker served this repository on this host, an
 *   absent dir is a missing journal and fails.
 * Limit: someone who deletes both the admission dir and the broker's state dirs makes a local check look like a clone;
 * that shows as `not verified here`, never as verified.
 */
export function checkAdmissionJournalAnchor(root: string, field: unknown): AdmissionJournalCheck {
  const malformed = anchorFormatProblem(field);
  if (malformed !== null) return { status: "mismatch", problem: malformed };
  const f = field as RunRecordAdmissionJournal;
  const local = localAdmission(root);
  if (local.kind === "error") return { status: "mismatch", problem: local.problem };
  const admissionDir = path.dirname(local.file);
  if (!local.admissionDir) {
    // An anchor of zero records loses nothing to a missing journal; where a broker served, it is checked, not unknown.
    if (f.count === 0 && local.brokerStateDir !== null) return { status: "verified" };
    if (local.brokerStateDir !== null) return { status: "mismatch", problem: `the admission dir ${admissionDir} is missing, but an admission broker served this repository on this host (${local.brokerStateDir}); the record names ${String(f.count)} records` };
    return { status: "not_verified_here", detail: `the record anchors ${String(f.count)} admission journal records (head ${f.head_digest.slice(0, 12)}), but this clone has no admission dir (${admissionDir}); the anchor's format was checked, its chain was not` };
  }
  let read: ReturnType<typeof readAdmissionJournalFile>;
  try {
    read = readAdmissionJournalFile(local.file, { count: f.count, headDigest: f.head_digest });
  } catch (err) {
    return { status: "mismatch", problem: `the journal cannot be read (${errText(err)})` };
  }
  if (!read.exists) return f.count === 0 ? { status: "verified" } : { status: "mismatch", problem: `the journal is missing (${local.file}); the record names ${String(f.count)} records` };
  return read.verdict.ok ? { status: "verified" } : { status: "mismatch", problem: `${read.verdict.problem} at record ${read.verdict.index} (${read.verdict.detail})` };
}

/**
 * Judge a record that has no admission journal anchor (PR #370 review round 2). Records are writable outside the cage, so
 * a removed anchor must not pass cleanly: where this host shows admission for the repository (its admission dir or
 * journal, or a broker's state dir), a record without an anchor fails, since `--record` writes an anchor there (with
 * zero records when nothing was journaled). Without a recorded anchor or evidence of local admission there is nothing to check.
 */
function checkMissingAdmissionJournalAnchor(root: string): AdmissionJournalCheck | null {
  const local = localAdmission(root);
  if (local.kind === "error") return { status: "mismatch", problem: local.problem };
  if (local.admissionDir) return { status: "mismatch", problem: `the run record has no admission_journal anchor, but the admission ${local.journal ? "journal" : "dir"} exists (${local.journal ? local.file : path.dirname(local.file)}); re-record the run` };
  if (local.brokerStateDir !== null) return { status: "mismatch", problem: `the run record has no admission_journal anchor, but an admission broker served this repository on this host (${local.brokerStateDir}); re-record the run` };
  return null;
}

/** Why the record's anchor fails here, or null (verified, or not verifiable in this clone: see `checkAdmissionJournalAnchor`). */
export function admissionJournalProblem(root: string, field: unknown): string | null {
  const check = checkAdmissionJournalAnchor(root, field);
  return check.status === "mismatch" ? check.problem : null;
}

/** The label a passing verify shows for an anchor that could not be checked here. */
export const ADMISSION_JOURNAL_NOT_VERIFIED_LABEL = "admission_journal: not verified here";

export function evaluateRunRecordPhase(ctx: PhaseContext, msnId: string): RunRecordPhaseOutcome {
  const recordRel = runRecordRelPath(msnId);
  const record = readRunRecord(ctx.root, recordRel);
  const missionRel = formatRepoRelative(ctx.root, ctx.mission.rawPath);
  const headKnown = typeof record?.head === "string" && gitRevParse(ctx.root, record.head) !== null;
  const anchor = record === null ? null : record.admission_journal !== undefined ? checkAdmissionJournalAnchor(ctx.root, record.admission_journal) : checkMissingAdmissionJournalAnchor(ctx.root);
  const finding = evaluateRunRecord(record, {
    msnId,
    missionPath: missionRel,
    lawSha256: missionLawSha256(ctx),
    headIsAncestor: headKnown && headIsAncestor(ctx.root, record!.head),
    changedSinceHead: headKnown ? changedSinceHead(ctx, record!.head, recordRel) : [],
    admissionJournalProblem: anchor?.status === "mismatch" ? anchor.problem : null,
  });
  if (!finding) return { kind: "ok", recordPath: recordRel, notes: anchor?.status === "not_verified_here" ? [`${ADMISSION_JOURNAL_NOT_VERIFIED_LABEL} (${anchor.detail})`] : [] };
  return {
    kind: "fail",
    failure: {
      ok: false,
      phase: "run_record",
      message: `RUN RECORD ${finding.kind.toUpperCase()}: ${finding.reason}`,
      exitCode: 1,
      executorLogPath: ctx.executorLogPath,
      recordKind: finding.kind,
      recordReason: finding.reason,
      recordPath: recordRel,
      ...(finding.stalePaths ? { stalePaths: finding.stalePaths } : {}),
    },
  };
}

/** `--record` needs a clean, committed tree so the record's head names the tree the checks ran on. */
export function assertCleanTreeForRecord(root: string): void {
  const status = gitRunOk(root, ["status", "--porcelain"]);
  const dirty = status.ok ? status.stdout.trim() : "(git status failed)";
  if (dirty.length === 0) return;
  const shown = dirty.split("\n").slice(0, 5).join("\n");
  throw new GantryUserError(
    "INVALID_ARGUMENT",
    `gantry verify --record needs a clean, committed working tree; commit or stash first:\n${shown}`,
    undefined,
    2,
  );
}

interface RunRecordGateResult {
  command: string;
  exit: number | null;
  durationMs: number;
  logText: string;
}

/** Write `.gitagent/runs/<MSN>.json` for the current HEAD. The caller commits it. */
export function writeRunRecord(ctx: PhaseContext, msnId: string, gate: RunRecordGateResult): string {
  assertCleanTreeForRecord(ctx.root);
  const head = gitRevParse(ctx.root, "HEAD");
  const tree = gitRunOk(ctx.root, ["rev-parse", "HEAD^{tree}"]);
  if (!head || !tree.ok) throw new GantryUserError("INVALID_ARGUMENT", "gantry verify --record needs a commit at HEAD", undefined, 2);
  const record: RunRecord = {
    schema: RUN_RECORD_SCHEMA,
    kind: "verify",
    msn_id: msnId,
    mission_path: formatRepoRelative(ctx.root, ctx.mission.rawPath),
    head,
    tree: tree.stdout.trim(),
    law_sha256: missionLawSha256(ctx),
    checks: [{ name: "gate", command: gate.command, exit: gate.exit, duration_ms: gate.durationMs, output_sha256: sha256Hex(gate.logText) }],
    status: "PASS",
    issued_at: new Date().toISOString(),
  };
  const anchor = admissionJournalAnchorForRecord(ctx.root);
  if (anchor !== undefined) record.admission_journal = anchor;
  const rel = runRecordRelPath(msnId);
  const abs = path.join(ctx.root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return rel;
}
