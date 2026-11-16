import crypto from "node:crypto";
import { canonicalJson } from "#core/canonical-json.js";
import { CLI_NAME, REL_PLANNER_SIGNING_PUB } from "#core/constants.js";
import { toPosixRel } from "#core/posix-path.js";
import { BYPASS_NOTE_NAMESPACE, bypassNoteVerdict } from "#core/trusted-automation.js";
import { gitConfigGet, gitHead, gitRevParse, gitRun } from "#git/git.js";
import { sshSignWithGitKey } from "#git/receipt-signing.js";
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

/** Local default branches; used only in a repository with no remote at all. */
const LOCAL_DEFAULT_REFS = ["refs/heads/main", "refs/heads/master"];
const SET_HEAD_HINT = "run: git fetch && git remote set-head origin --auto";

/** `tip` is the default branch commit itself: what CI's `base.sha` is when a pull request targets it. */
type AnchorBase = { ok: true; base: string; tip: string } | { ok: false; why: string };

/**
 * The trusted base for the anchor (MSN-0381): the merge-base of HEAD with the one default branch. With any remote, that
 * is refs/remotes/origin/HEAD and nothing else: a deleted or moved origin/main and a local main the agent committed to
 * never stand in for it. Only a repository without any remote uses local main or master (exactly one must exist). A
 * default branch without shared history refuses. Rewriting origin/HEAD itself is the disclosed local limit; CI decides.
 */
function breakGlassAnchorBase(repoRoot: string): AnchorBase {
  const remotes = gitRun(repoRoot, ["remote"]);
  if (!remotes.ok) return { ok: false, why: "not a git repository" };
  const resolves = (ref: string): boolean => gitRun(repoRoot, ["rev-parse", "--verify", "-q", `${ref}^{commit}`]).ok;
  let ref: string;
  if (remotes.stdout.trim()) {
    ref = "refs/remotes/origin/HEAD";
    if (!resolves(ref)) return { ok: false, why: `a remote is configured but origin/HEAD does not resolve (${SET_HEAD_HINT})` };
  } else {
    const found = LOCAL_DEFAULT_REFS.filter(resolves);
    if (found.length !== 1) {
      return { ok: false, why: found.length ? "main and master both exist, so the default branch is ambiguous" : "no remote and no local main or master" };
    }
    ref = found[0]!;
  }
  const short = ref.replace(/^refs\/(remotes|heads)\//, "");
  const mb = gitRun(repoRoot, ["merge-base", "HEAD", ref]);
  const base = mb.ok ? mb.stdout.trim() : "";
  const tip = gitRun(repoRoot, ["rev-parse", "--verify", "-q", `${ref}^{commit}`]).stdout.trim();
  return base ? { ok: true, base, tip } : { ok: false, why: `HEAD shares no history with the default branch ${short}` };
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
  const found = breakGlassAnchorBase(repoRoot);
  if (!found.ok) {
    return { ok: false, code: "BYPASS_BASE_UNKNOWN", message: `no trusted base commit: ${found.why}; the ${REL_BYPASS_SHA256} anchor is read only from there.` };
  }
  const base = found.base;
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
  payload: object,
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

/**
 * The version 2 note (MSN-0385): the audit payload bound to the commit and the signer, SSH-signed with the git signing
 * key over its canonical JSON. CI counts it only when the base commit's PLANNER.signing.pub lists that key for the
 * signer (bypassNoteVerdict). No signing key refuses: an unsigned note would never count.
 */
function signedBypassNote(root: string, commit: string, payload: BypassAuditPayload): Record<string, unknown> {
  const unavailable = (why: string): Error =>
    new Error(`${CLI_NAME}: break-glass: BYPASS_SIGNING_UNAVAILABLE — ${why}. CI counts a gxt-bypass note only when it is SSH-signed by a Planner key listed in ${REL_PLANNER_SIGNING_PUB}; or use --audit-commit.`);
  const signer = gitConfigGet(root, "user.email")?.trim();
  if (!signer) throw unavailable("git user.email is not set, and the note names its signer");
  const body = { ...payload, v: 2, commit, signer };
  const signature = sshSignWithGitKey(root, canonicalJson(body), BYPASS_NOTE_NAMESPACE);
  if (!signature) throw unavailable("no SSH signature: set gpg.format=ssh and user.signingkey to an ed25519 key");
  return { ...body, signature };
}

/**
 * A warning when CI would refuse the note just written: its key is not a Planner key at the default branch tip
 * (origin/HEAD itself, which a pull request's base.sha is), not the merge-base the anchor is read from.
 */
function noteCheckWarning(root: string, commit: string, note: Record<string, unknown>): string | null {
  const found = breakGlassAnchorBase(root);
  const signers = found.ok ? gitRun(root, ["cat-file", "blob", `${found.tip}:${REL_PLANNER_SIGNING_PUB}`]) : null;
  const verdict = bypassNoteVerdict(JSON.stringify(note), commit, signers?.ok ? signers.stdout : null);
  return verdict.ok ? null : `break-glass: CI will refuse this note: ${verdict.why}`;
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
): { commitSha: string; warning: string | null } {
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
    return { commitSha: gitHead(root) ?? commitSha, warning: null };
  }

  const note = signedBypassNote(root, commitSha, payload);
  writeBypassGitNote(root, commitSha, note);
  return { commitSha, warning: noteCheckWarning(root, commitSha, note) };
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
    const { commitSha, warning: noteWarning } = runBreakGlassAudit(root, {
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
    const warnings = [noteWarning, ledgerFailureLine(ledger)].filter((w): w is string => w !== null);
    return {
      kind: "ok",
      warnings,
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
