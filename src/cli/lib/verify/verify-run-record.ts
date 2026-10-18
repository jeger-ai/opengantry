/**
 * Run-record phase (ADR-0052 A4, A5; RULES §3). A mission without trace rows is judged by `.gitagent/runs/<MSN>.json`,
 * which `gantry verify --record` writes after a full pass on a clean, committed tree. This loader supplies the git facts;
 * the judgement is `evaluateRunRecord` in core.
 */
import fs from "node:fs";
import path from "node:path";
import { canonicalJson } from "#core/canonical-json.js";
import { REL_RUNS_DIR } from "#core/constants.js";
import { evaluateRunRecord, RUN_RECORD_SCHEMA, sha256Hex, type RunRecord } from "#core/run-record.js";
import { gitDiffNameOnlySinceCommit, gitRevParse, gitRunOk } from "../git/git.js";
import { resolveEffectiveScopeForMission } from "../contract/effective-scope.js";
import { GantryUserError } from "../errors.js";
import { formatRepoRelative } from "../cli-io.js";
import type { RunRecordFailure } from "./verify-failure.js";
import type { PhaseContext } from "./verify-phase-steps.js";

export type RunRecordPhaseOutcome = { kind: "ok"; recordPath: string } | { kind: "fail"; failure: RunRecordFailure };

export function runRecordRelPath(msnId: string): string {
  return `${REL_RUNS_DIR}/${msnId}.json`;
}

export function missionHasRunRecord(root: string, msnId: string | null): boolean {
  return msnId !== null && fs.existsSync(path.join(root, runRecordRelPath(msnId)));
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
export function missionLawSha256(ctx: PhaseContext): string {
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
      ...(record?.head ? { recordHead: record.head } : {}),
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

export interface RunRecordGateResult {
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
  const rel = runRecordRelPath(msnId);
  const abs = path.join(ctx.root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return rel;
}
