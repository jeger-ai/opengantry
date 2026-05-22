import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CLI_NAME } from "./constants.js";
import { gitRun } from "./git-repo.js";

export const DRAFT_TOKEN_TTL_SECONDS_DEFAULT = 600;
export const DRAFT_TOKEN_TTL_SECONDS_MIN = 120;
export const DRAFT_TOKEN_TTL_SECONDS_MAX = 1800;
export const DRAFT_TOKEN_KEY_REL = ".gitagent/foreman/DRAFT_TOKEN.key";
export const DRAFT_TOKEN_REPLAY_REL = ".gitagent/history/.draft-token-replay.json";

export interface DraftLegislationPayload {
  v: 1;
  draft_id: string;
  iat: number;
  exp: number;
  repo_fingerprint: string;
  title: string;
  msn_id: string;
  skill_key: string;
  gate_command: string;
  gate_success_substring?: string;
}

export type DraftTokenErrorCode =
  | "TOKEN_MALFORMED"
  | "TOKEN_SIGNATURE_INVALID"
  | "TOKEN_EXPIRED"
  | "TOKEN_REPO_MISMATCH"
  | "TOKEN_REPLAYED"
  | "TOKEN_KEY_MISSING";

export class DraftTokenError extends Error {
  readonly code: DraftTokenErrorCode;
  readonly retryable: boolean;

  constructor(code: DraftTokenErrorCode, message: string, retryable = true) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64url");
}

function base64UrlDecode(raw: string): Buffer {
  return Buffer.from(raw, "base64url");
}

/** Deterministic JSON with sorted object keys (recursive). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function computeRepoFingerprint(root: string): string {
  const absRoot = path.resolve(root);
  const head = gitRun(absRoot, ["rev-parse", "HEAD"]);
  const toplevel = gitRun(absRoot, ["rev-parse", "--show-toplevel"]);
  const headHash = head.ok ? head.stdout.trim() : "no-head";
  const top = toplevel.ok ? path.resolve(toplevel.stdout.trim()) : absRoot;
  return crypto.createHash("sha256").update(`${top}\0${headHash}`).digest("hex");
}

function draftTokenKeyPath(root: string): string {
  return path.join(root, DRAFT_TOKEN_KEY_REL.split("/").join(path.sep));
}

function ensureDraftTokenKey(root: string): Buffer {
  const keyPath = draftTokenKeyPath(root);
  if (fs.existsSync(keyPath)) {
    const raw = fs.readFileSync(keyPath);
    if (raw.length >= 32) return raw;
  }
  fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  try {
    fs.chmodSync(keyPath, 0o600);
  } catch {
    /* best effort */
  }
  return key;
}

function signPayload(payload: DraftLegislationPayload, key: Buffer): string {
  const body = canonicalJson(payload);
  return base64UrlEncode(crypto.createHmac("sha256", key).update(body, "utf8").digest());
}

function replayLedgerPath(root: string): string {
  return path.join(root, DRAFT_TOKEN_REPLAY_REL.split("/").join(path.sep));
}

function readReplaySet(root: string): Set<string> {
  const abs = replayLedgerPath(root);
  if (!fs.existsSync(abs)) return new Set();
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, "utf8")) as { used?: string[] };
    return new Set(Array.isArray(parsed.used) ? parsed.used : []);
  } catch {
    return new Set();
  }
}

function markDraftUsed(root: string, draftId: string): void {
  const abs = replayLedgerPath(root);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const used = readReplaySet(root);
  used.add(draftId);
  const trimmed = [...used].slice(-500);
  fs.writeFileSync(abs, JSON.stringify({ used: trimmed }, null, 2), "utf8");
}

export function createDraftToken(
  root: string,
  input: Omit<DraftLegislationPayload, "v" | "draft_id" | "iat" | "exp" | "repo_fingerprint"> & {
    ttlSeconds?: number;
  },
): { draft_token: string; payload: DraftLegislationPayload; expires_at: string } {
  const ttlRaw = input.ttlSeconds ?? DRAFT_TOKEN_TTL_SECONDS_DEFAULT;
  const ttl = Math.min(
    DRAFT_TOKEN_TTL_SECONDS_MAX,
    Math.max(DRAFT_TOKEN_TTL_SECONDS_MIN, ttlRaw),
  );
  const now = Math.floor(Date.now() / 1000);
  const payload: DraftLegislationPayload = {
    v: 1,
    draft_id: crypto.randomUUID(),
    iat: now,
    exp: now + ttl,
    repo_fingerprint: computeRepoFingerprint(root),
    title: input.title.trim(),
    msn_id: input.msn_id.trim(),
    skill_key: input.skill_key.trim(),
    gate_command: input.gate_command.trim(),
  };
  if (input.gate_success_substring?.trim()) {
    payload.gate_success_substring = input.gate_success_substring.trim();
  }

  const key = ensureDraftTokenKey(root);
  const encoded = base64UrlEncode(Buffer.from(canonicalJson(payload), "utf8"));
  const signature = signPayload(payload, key);
  return {
    draft_token: `${encoded}.${signature}`,
    payload,
    expires_at: new Date(payload.exp * 1000).toISOString(),
  };
}

export function verifyDraftToken(root: string, draftToken: string, options?: { consume?: boolean }): DraftLegislationPayload {
  const parts = draftToken.trim().split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new DraftTokenError("TOKEN_MALFORMED", `${CLI_NAME} draft token malformed`, true);
  }

  let payloadRaw: string;
  try {
    payloadRaw = base64UrlDecode(parts[0]).toString("utf8");
  } catch {
    throw new DraftTokenError("TOKEN_MALFORMED", `${CLI_NAME} draft token payload decode failed`, true);
  }

  let payload: DraftLegislationPayload;
  try {
    payload = JSON.parse(payloadRaw) as DraftLegislationPayload;
  } catch {
    throw new DraftTokenError("TOKEN_MALFORMED", `${CLI_NAME} draft token payload JSON invalid`, true);
  }

  if (payload.v !== 1) {
    throw new DraftTokenError("TOKEN_MALFORMED", `${CLI_NAME} draft token version unsupported`, false);
  }

  const keyPath = draftTokenKeyPath(root);
  if (!fs.existsSync(keyPath)) {
    throw new DraftTokenError(
      "TOKEN_KEY_MISSING",
      `${CLI_NAME} draft token key missing at ${DRAFT_TOKEN_KEY_REL}`,
      false,
    );
  }
  const key = fs.readFileSync(keyPath);
  const expectedSig = signPayload(payload, key);
  const providedSig = parts[1];
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  const providedBuf = Buffer.from(providedSig, "utf8");
  if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    throw new DraftTokenError("TOKEN_SIGNATURE_INVALID", `${CLI_NAME} draft token signature invalid`, true);
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    throw new DraftTokenError("TOKEN_EXPIRED", `${CLI_NAME} draft token expired; re-run gxt_draft_legislation`, true);
  }

  const fingerprint = computeRepoFingerprint(root);
  if (payload.repo_fingerprint !== fingerprint) {
    throw new DraftTokenError(
      "TOKEN_REPO_MISMATCH",
      `${CLI_NAME} draft token was issued for a different repository state`,
      true,
    );
  }

  if (readReplaySet(root).has(payload.draft_id)) {
    throw new DraftTokenError("TOKEN_REPLAYED", `${CLI_NAME} draft token already executed`, true);
  }

  if (options?.consume !== false) {
    markDraftUsed(root, payload.draft_id);
  }

  return payload;
}
