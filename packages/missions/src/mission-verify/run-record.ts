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
import { ADMISSION_JOURNAL_REL, admissionJournalPath, readAdmissionJournalFile } from "../admission/journal-file.js";
import { gitDiffNameOnlySinceCommit, gitRevParse, gitRunOk } from "#git/git.js";
import { resolveEffectiveScopeForMission } from "../contract/effective-scope.js";
import { GantryUserError } from "#core/user-error.js";
import { formatRepoRelative } from "#core/posix-path.js";
import type { RunRecordFailure } from "./failure.js";
import type { PhaseContext } from "./phase-steps.js";

type RunRecordPhaseOutcome = { kind: "ok"; recordPath: string } | { kind: "fail"; failure: RunRecordFailure };

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

/**
 * The admission journal's anchor for a new run record (ADR-0063 owner decision Q6), or undefined when the repository has
 * no journal. A journal that does not verify refuses the record: an anchor is never bound to a damaged journal.
 */
export function admissionJournalAnchorForRecord(root: string): RunRecordAdmissionJournal | undefined {
  const file = admissionJournalPath(root);
  if (file === null) return undefined;
  const read = readAdmissionJournalFile(file);
  if (!read.exists) return undefined;
  if (!read.verdict.ok) {
    const v = read.verdict;
    throw new GantryUserError("GXT_ADMISSION_JOURNAL_INVALID", `gantry verify --record: the admission journal ${file} does not verify (${v.problem} at record ${v.index}: ${v.detail})`, "Keep the journal for the investigation; a run record is not written over a damaged journal.", 1);
  }
  return { path: ADMISSION_JOURNAL_REL, count: read.verdict.count, head_digest: read.verdict.headDigest };
}

/**
 * Why the repository's admission journal does not match a record's anchor, or null when it matches (records appended
 * after the anchor are fine). A missing journal, a cut at or before the anchor, or a rewrite all fail. Fail closed: a
 * record that carries an anchor verifies only where its journal lives.
 */
export function admissionJournalProblem(root: string, field: unknown): string | null {
  const f = field as Partial<RunRecordAdmissionJournal> | null;
  if (typeof f !== "object" || f === null || f.path !== ADMISSION_JOURNAL_REL || !Number.isSafeInteger(f.count) || (f.count as number) < 0 || !/^[0-9a-f]{64}$/.test(String(f.head_digest))) {
    return "the record's admission_journal field is malformed";
  }
  const file = admissionJournalPath(root);
  if (file === null) return "not a git repository";
  const read = readAdmissionJournalFile(file, { count: f.count as number, headDigest: f.head_digest as string });
  if (!read.exists) return f.count === 0 ? null : `the journal is missing (${file}); the record names ${String(f.count)} records`;
  return read.verdict.ok ? null : `${read.verdict.problem} at record ${read.verdict.index} (${read.verdict.detail})`;
}

export function evaluateRunRecordPhase(ctx: PhaseContext, msnId: string): RunRecordPhaseOutcome {
  const recordRel = runRecordRelPath(msnId);
  const record = readRunRecord(ctx.root, recordRel);
  const missionRel = formatRepoRelative(ctx.root, ctx.mission.rawPath);
  const headKnown = typeof record?.head === "string" && gitRevParse(ctx.root, record.head) !== null;
  const finding = evaluateRunRecord(record, {
    msnId,
    missionPath: missionRel,
    lawSha256: missionLawSha256(ctx),
    headIsAncestor: headKnown && headIsAncestor(ctx.root, record!.head),
    changedSinceHead: headKnown ? changedSinceHead(ctx, record!.head, recordRel) : [],
    admissionJournalProblem: record !== null && record.admission_journal !== undefined ? admissionJournalProblem(ctx.root, record.admission_journal) : null,
  });
  if (!finding) return { kind: "ok", recordPath: recordRel };
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
