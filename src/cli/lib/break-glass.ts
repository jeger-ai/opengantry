import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CLI_NAME } from "./constants.js";
import { toPosixRel } from "./cli-io.js";
import { gitHead, gitRevParse, gitRun } from "./git.js";
import type { ParsedMission } from "./types.js";
import type { VerifyOptions } from "./verify-options.js";

export const ENV_BYPASS_SECRET = "GXT_BYPASS_SECRET";
export const REL_BYPASS_SHA256 = ".gitagent/foreman/BYPASS.sha256";
export const GXT_BYPASS_NOTES_REF = "refs/notes/gxt-bypass";

const MIN_REASON_LENGTH = 10;

export interface BypassAuditPayload {
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

function readAnchorHash(repoRoot: string): string | null {
  const anchorPath = path.join(repoRoot, REL_BYPASS_SHA256);
  if (!fs.existsSync(anchorPath)) return null;
  for (const line of fs.readFileSync(anchorPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/^[a-f0-9]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  }
  return null;
}

/** True when GXT_BYPASS_SECRET matches committed BYPASS.sha256 anchor. */
export function isBypassSecretAuthorized(repoRoot: string): boolean {
  const secret = process.env[ENV_BYPASS_SECRET];
  if (!secret?.length) return false;
  const anchor = readAnchorHash(repoRoot);
  if (!anchor) return false;
  return timingSafeEqualHex(sha256Hex(secret), anchor);
}

export function assertBypassSecretAuthorized(repoRoot: string): void {
  if (isBypassSecretAuthorized(repoRoot)) return;
  const anchorPath = path.join(repoRoot, REL_BYPASS_SHA256);
  if (!fs.existsSync(anchorPath)) {
    throw new Error(
      `${CLI_NAME}: break-glass: BYPASS_NOT_CONFIGURED — ${REL_BYPASS_SHA256} is missing. Planner must install a SHA-256 anchor of the team secret.`,
    );
  }
  if (!process.env[ENV_BYPASS_SECRET]?.length) {
    throw new Error(
      `${CLI_NAME}: break-glass: BYPASS_SECRET_MISSING — Set ${ENV_BYPASS_SECRET} in the execution environment.`,
    );
  }
  throw new Error(
    `${CLI_NAME}: break-glass: BYPASS_SECRET_INVALID — ${ENV_BYPASS_SECRET} does not match ${REL_BYPASS_SHA256}.`,
  );
}

export function validateBreakGlassReason(reason: string | undefined): string {
  const trimmed = reason?.trim() ?? "";
  if (trimmed.length < MIN_REASON_LENGTH) {
    throw new Error(
      `${CLI_NAME}: break-glass: REASON_REQUIRED — Provide --reason with at least ${String(MIN_REASON_LENGTH)} characters.`,
    );
  }
  return trimmed;
}

export function parseBypassNoteBody(noteBody: string): BypassAuditPayload | null {
  const trimmed = noteBody.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Partial<BypassAuditPayload>;
    if (parsed.v !== 1) return null;
    if (typeof parsed.reason !== "string" || parsed.reason.trim().length < MIN_REASON_LENGTH) {
      return null;
    }
    return {
      v: 1,
      reason: parsed.reason.trim(),
      ts: typeof parsed.ts === "string" ? parsed.ts : "",
      msn_id: typeof parsed.msn_id === "string" ? parsed.msn_id : undefined,
      mission_file: typeof parsed.mission_file === "string" ? parsed.mission_file : undefined,
    };
  } catch {
    return null;
  }
}

export function commitHasValidBypassNote(root: string, commit: string): boolean {
  const r = gitRun(root, ["notes", `--ref=${GXT_BYPASS_NOTES_REF}`, "show", commit]);
  if (!r.ok) return false;
  return parseBypassNoteBody(r.stdout) !== null;
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

export function runBreakGlassAudit(
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

export interface BreakGlassAuditOk {
  kind: "ok";
  missionRel: string;
  commitSha: string;
  reason: string;
  msnId?: string;
  auditCommit: boolean;
}

export interface BreakGlassAuditFail {
  kind: "fail";
  error: unknown;
}

export type BreakGlassAuditOutcome = BreakGlassAuditOk | BreakGlassAuditFail;

/** Single break-glass audit path shared by human and JSON presenters. */
export function runBreakGlassAuditFlow(
  root: string,
  mission: ParsedMission,
  options: VerifyOptions,
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
    return {
      kind: "ok",
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
