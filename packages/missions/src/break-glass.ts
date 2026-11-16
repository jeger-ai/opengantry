import crypto from "node:crypto";
import { CLI_NAME } from "#core/constants.js";
import { toPosixRel } from "#core/posix-path.js";
import { gitHead, gitRevParse, gitRun } from "#git/git.js";
import { msnIdOrDefault, type ParsedMission } from "#core/mission-types.js";
import type { VerifyEvaluation } from "./mission-verify/options.js";
import { appendLedgerIfEnabled, ledgerFailureLine } from "./ledger/ledger-append.js";

export const ENV_BYPASS_SECRET = "GANTRY_BYPASS_SECRET";
const REL_BYPASS_SHA256 = ".gitagent/foreman/BYPASS.sha256";
export const GXT_BYPASS_NOTES_REF = "refs/notes/gxt-bypass";

const MIN_REASON_LENGTH = 10;

interface BypassAuditPayload {
  v: 1;
  reason: string;
  ts: string;
  msn_id?: string;
  mission_file?: string;
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/** Remote default branches first; local ones only when the repository has no remote default branch. */
const REMOTE_DEFAULT_REFS = ["refs/remotes/origin/HEAD", "refs/remotes/origin/main", "refs/remotes/origin/master"];
const LOCAL_DEFAULT_REFS = ["refs/heads/main", "refs/heads/master"];

/**
 * The trusted base for the anchor (MSN-0381): the merge-base of HEAD with the default branch, the newest of them. A
 * commit the change under review adds is never its own base, so neither a working-tree edit nor a commit on the branch
 * moves the anchor. Null when no default branch shares history with HEAD.
 */
function breakGlassAnchorBase(repoRoot: string): string | null {
  for (const refs of [REMOTE_DEFAULT_REFS, LOCAL_DEFAULT_REFS]) {
    const bases = refs
      .map((ref) => gitRun(repoRoot, ["merge-base", "HEAD", ref]))
      .filter((r) => r.ok && r.stdout.trim().length > 0)
      .map((r) => r.stdout.trim());
    const scored = bases.map((base) => {
      const count = gitRun(repoRoot, ["rev-list", "--count", `${base}..HEAD`]);
      return { base, n: count.ok && count.stdout.trim() !== "" ? Number(count.stdout.trim()) : Number.NaN };
    });
    const best = scored.filter((x) => Number.isInteger(x.n)).sort((a, b) => a.n - b.n)[0];
    if (best) return best.base;
  }
  return null;
}

function parseAnchor(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/^[a-f0-9]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  }
  return null;
}

type BypassVerdict = { ok: true } | { ok: false; code: string; message: string };

/** Authorization against the anchor committed at the trusted base, never the working tree. Fails closed. */
export function bypassAuthorization(repoRoot: string): BypassVerdict {
  const base = breakGlassAnchorBase(repoRoot);
  if (!base) {
    return {
      ok: false,
      code: "BYPASS_BASE_UNKNOWN",
      message: `no trusted base commit (merge-base of HEAD with origin/HEAD, origin/main, origin/master, else main or master); the ${REL_BYPASS_SHA256} anchor is read only from there.`,
    };
  }
  const blob = gitRun(repoRoot, ["cat-file", "blob", `${base}:${REL_BYPASS_SHA256}`]);
  const anchor = blob.ok ? parseAnchor(blob.stdout) : null;
  if (!anchor) {
    return {
      ok: false,
      code: "BYPASS_NOT_CONFIGURED",
      message: `${REL_BYPASS_SHA256} has no SHA-256 anchor at the base commit ${base.slice(0, 12)}. Planner must commit an anchor of the team secret to the default branch.`,
    };
  }
  const secret = process.env[ENV_BYPASS_SECRET];
  if (!secret?.length) {
    return { ok: false, code: "BYPASS_SECRET_MISSING", message: `Set ${ENV_BYPASS_SECRET} in the execution environment.` };
  }
  if (!timingSafeEqualHex(sha256Hex(secret), anchor)) {
    return { ok: false, code: "BYPASS_SECRET_INVALID", message: `${ENV_BYPASS_SECRET} does not match ${REL_BYPASS_SHA256} at the base commit ${base.slice(0, 12)}.` };
  }
  return { ok: true };
}

/** True when GANTRY_BYPASS_SECRET matches the BYPASS.sha256 anchor committed at the trusted base. */
export function isBypassSecretAuthorized(repoRoot: string): boolean {
  return bypassAuthorization(repoRoot).ok;
}

function assertBypassSecretAuthorized(repoRoot: string): void {
  const verdict = bypassAuthorization(repoRoot);
  if (!verdict.ok) throw new Error(`${CLI_NAME}: break-glass: ${verdict.code} — ${verdict.message}`);
}

function validateBreakGlassReason(reason: string | undefined): string {
  const trimmed = reason?.trim() ?? "";
  if (trimmed.length < MIN_REASON_LENGTH) {
    throw new Error(
      `${CLI_NAME}: break-glass: REASON_REQUIRED — Provide --reason with at least ${String(MIN_REASON_LENGTH)} characters.`,
    );
  }
  return trimmed;
}

export function writeBypassGitNote(
  root: string,
  commit: string,
  payload: BypassAuditPayload,
): void {
  const message = JSON.stringify(payload);
  const r = gitRun(root, ["notes", `--ref=${GXT_BYPASS_NOTES_REF}`, "add", "-f", "-m", message, commit]);
  if (!r.ok) {
    throw new Error(`${CLI_NAME}: break-glass: git notes add failed: ${r.stderr.trim() || "unknown"}`);
  }
}

function resolveAuditCommit(root: string, commit?: string): string {
  if (commit?.trim()) {
    const sha = gitRevParse(root, commit);
    if (!sha) {
      throw new Error(`${CLI_NAME}: break-glass: invalid --commit ${commit}`);
    }
    return sha;
  }
  const sha = gitHead(root);
  if (!sha) {
    throw new Error(`${CLI_NAME}: break-glass: cannot resolve HEAD`);
  }
  return sha;
}

function runBreakGlassAudit(
  root: string,
  options: {
    reason: string;
    msnId?: string | null;
    missionFile?: string;
    commit?: string;
    auditCommit?: boolean;
  },
): string {
  const commitSha = resolveAuditCommit(root, options.commit);
  const payload: BypassAuditPayload = {
    v: 1,
    reason: options.reason,
    ts: new Date().toISOString(),
    ...(options.msnId ? { msn_id: options.msnId } : {}),
    ...(options.missionFile ? { mission_file: options.missionFile } : {}),
  };

  if (options.auditCommit === true) {
    const subjectReason =
      options.reason.length > 72 ? `${options.reason.slice(0, 69)}...` : options.reason;
    const subject = `[GXT-AUDIT] break-glass: ${subjectReason}`;
    const body = JSON.stringify(payload, null, 2);
    const r = gitRun(root, ["commit", "--allow-empty", "-m", subject, "-m", body]);
    if (!r.ok) {
      throw new Error(`${CLI_NAME}: break-glass: audit commit failed: ${r.stderr.trim() || "unknown"}`);
    }
    return gitHead(root) ?? commitSha;
  }

  writeBypassGitNote(root, commitSha, payload);
  return commitSha;
}

interface BreakGlassAuditOk {
  /** A failed ledger append, for the presenter. */
  warnings: string[];
  kind: "ok";
  missionRel: string;
  commitSha: string;
  reason: string;
  msnId?: string;
  auditCommit: boolean;
}

interface BreakGlassAuditFail {
  kind: "fail";
  error: unknown;
}

type BreakGlassAuditOutcome = BreakGlassAuditOk | BreakGlassAuditFail;

/** Single break-glass audit path shared by human and JSON presenters. */
export function runBreakGlassAuditFlow(
  root: string,
  mission: ParsedMission,
  options: VerifyEvaluation,
): BreakGlassAuditOutcome {
  try {
    const reason = validateBreakGlassReason(options.breakGlassReason);
    assertBypassSecretAuthorized(root);
    const missionRel = toPosixRel(root, mission.rawPath);
    const commitSha = runBreakGlassAudit(root, {
      reason,
      msnId: mission.msnId,
      missionFile: missionRel,
      commit: options.breakGlassCommit,
      auditCommit: options.auditCommit === true,
    });
    const ledger = appendLedgerIfEnabled(root, "break_glass", msnIdOrDefault(mission), {
      reason_sha256: crypto.createHash("sha256").update(reason).digest("hex"),
      error_code: "BREAK_GLASS",
    });
    const warning = ledgerFailureLine(ledger);
    return {
      kind: "ok",
      warnings: warning === null ? [] : [warning],
      missionRel,
      commitSha,
      reason,
      msnId: mission.msnId ?? undefined,
      auditCommit: options.auditCommit === true,
    };
  } catch (error) {
    return { kind: "fail", error };
  }
}
