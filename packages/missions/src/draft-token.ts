import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GANTRY_STATE_HOME_REL } from "#core/secret-paths.js";
import { fromPosix } from "#core/posix-path.js";
import { CLI_NAME } from "#core/constants.js";
import { canonicalJson } from "#core/canonical-json.js";
import { gitRun } from "#git/git.js";
import { DEFAULT_GATE_ADAPTER, isGateAdapterId, type GateAdapterId } from "#core/gate-adapter.js";
import { type MissionContract } from "#core/contract-types.js";
import { contractSha256, normalizeContract } from "./contract/contract-hash.js";

const DRAFT_TOKEN_TTL_SECONDS_DEFAULT = 600;
const DRAFT_TOKEN_TTL_SECONDS_MIN = 120;
const DRAFT_TOKEN_TTL_SECONDS_MAX = 1800;
/** Where the key lived before MSN-0381: readable by the agent's own user, so its presence refuses. */
const DRAFT_TOKEN_LEGACY_KEY_REL = ".gitagent/foreman/DRAFT_TOKEN.key";
const DRAFT_TOKEN_STATE_FILE = "draft-token.json";
const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 30_000;

import type { InterrogationRow } from "#core/interrogation.js";

interface DraftLegislationPayload {
  v: 2 | 3;
  draft_id: string;
  iat: number;
  exp: number;
  repo_fingerprint: string;
  title: string;
  msn_id: string;
  skill_key: string;
  gate_command: string;
  gate_success_substring?: string;
  /** Present only when not `generic` (ADR-0041). */
  gate_adapter?: GateAdapterId;
  interrogation: InterrogationRow[];
  interrogation_sha256: string;
  declared_paths: string[];
  /** v3: Planner-sealed cage. */
  contract?: MissionContract;
  contract_sha256?: string;
}

type DraftTokenErrorCode =
  | "TOKEN_MALFORMED"
  | "TOKEN_SIGNATURE_INVALID"
  | "TOKEN_EXPIRED"
  | "TOKEN_REPO_MISMATCH"
  | "TOKEN_REPLAYED"
  | "TOKEN_KEY_MISSING"
  | "TOKEN_LEGACY_KEY"
  | "TOKEN_STATE_INVALID";

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
function computeRepoFingerprint(root: string): string {
  const absRoot = path.resolve(root);
  const head = gitRun(absRoot, ["rev-parse", "HEAD"]);
  const toplevel = gitRun(absRoot, ["rev-parse", "--show-toplevel"]);
  const headHash = head.ok ? head.stdout.trim() : "no-head";
  const top = toplevel.ok ? path.resolve(toplevel.stdout.trim()) : absRoot;
  return crypto.createHash("sha256").update(`${top}\0${headHash}`).digest("hex");
}

/** Per-user state: the HMAC key and the consumed draft ids, in one file outside every repository (MSN-0381). */
interface DraftTokenState {
  v: 1;
  key: string;
  used: { id: string; exp: number }[];
}

const stateError = (message: string, retryable = false): DraftTokenError =>
  new DraftTokenError("TOKEN_STATE_INVALID", `${CLI_NAME} draft token state: ${message}`, retryable);
const realOrResolved = (p: string): string => (fs.existsSync(p) ? fs.realpathSync(p) : path.resolve(p));

/** `~/.opengantry/draft-token.json` (dir: `GANTRY_STATE_DIR`), which `gantry cage policy` denies; never inside the repository. */
function statePath(root: string): string {
  const dir = process.env.GANTRY_STATE_DIR?.trim() || path.join(os.homedir(), GANTRY_STATE_HOME_REL);
  if (!path.isAbsolute(dir)) throw stateError("the state dir must be an absolute path");
  const rel = path.relative(realOrResolved(root), realOrResolved(dir));
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) throw stateError("the state dir is inside the repository, where the agent can read the key");
  return path.join(dir, DRAFT_TOKEN_STATE_FILE);
}

/** An agent-readable key in the repository is never trusted: refuse until the operator deletes it. */
function assertNoLegacyKey(root: string): void {
  if (!fs.existsSync(path.join(root, fromPosix(DRAFT_TOKEN_LEGACY_KEY_REL)))) return;
  const message = `${CLI_NAME} draft token: ${DRAFT_TOKEN_LEGACY_KEY_REL} is readable by the agent and no longer trusted; delete it. The key now lives in ~/${GANTRY_STATE_HOME_REL}; drafts signed with the old key are refused.`;
  throw new DraftTokenError("TOKEN_LEGACY_KEY", message, false);
}

/** Missing is null (draft mints a key); unreadable or malformed refuses, so a damaged ledger never reads as empty. */
function readState(file: string): DraftTokenState | null {
  if (!fs.existsSync(file)) return null;
  let raw: Partial<DraftTokenState> = {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object") raw = parsed as Partial<DraftTokenState>;
  } catch {
    /* malformed: refused below */
  }
  const usedOk = Array.isArray(raw.used) && raw.used.every((u) => typeof u?.id === "string" && Number.isInteger(u.exp));
  if (raw.v !== 1 || typeof raw.key !== "string" || base64UrlDecode(raw.key).length < 32 || !usedOk) {
    throw stateError("malformed; delete it to rotate the key (outstanding drafts are then refused)");
  }
  return raw as DraftTokenState;
}

/** Read-modify-write under a lock directory, then an atomic rename: no lost consume, no second key. */
function withState<T>(root: string, fn: (state: DraftTokenState | null, write: (next: DraftTokenState) => void) => T): T {
  assertNoLegacyKey(root);
  const file = statePath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.lock`;
  for (const deadline = Date.now() + LOCK_WAIT_MS; ; ) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch {
      if (Date.now() - (fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now()) > LOCK_STALE_MS) fs.rmSync(lock, { recursive: true, force: true });
      else if (Date.now() > deadline) throw stateError("locked by another process", true);
      else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    return fn(readState(file), (next) => {
      const tmp = `${file}.${String(process.pid)}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(next)}\n`, { mode: 0o600 });
      fs.renameSync(tmp, file);
    });
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

function ensureDraftTokenKey(root: string): Buffer {
  return withState(root, (state, write) => {
    if (state) return base64UrlDecode(state.key);
    const key = crypto.randomBytes(32);
    write({ v: 1, key: base64UrlEncode(key), used: [] });
    return key;
  });
}

function signPayload(payload: DraftLegislationPayload, key: Buffer): string {
  const body = canonicalJson(payload);
  return base64UrlEncode(crypto.createHmac("sha256", key).update(body, "utf8").digest());
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
  const contract = input.contract ? normalizeContract(input.contract) : undefined;
  const payload: DraftLegislationPayload = {
    v: 3,
    draft_id: crypto.randomUUID(),
    iat: now,
    exp: now + ttl,
    repo_fingerprint: computeRepoFingerprint(root),
    title: input.title.trim(),
    msn_id: input.msn_id.trim(),
    skill_key: input.skill_key.trim(),
    gate_command: input.gate_command.trim(),
    interrogation: input.interrogation,
    interrogation_sha256: input.interrogation_sha256,
    declared_paths: input.declared_paths,
  };
  if (input.gate_success_substring?.trim()) {
    payload.gate_success_substring = input.gate_success_substring.trim();
  }
  if (input.gate_adapter !== undefined && input.gate_adapter !== DEFAULT_GATE_ADAPTER) {
    payload.gate_adapter = input.gate_adapter;
  }
  if (contract) {
    payload.contract = contract;
    payload.contract_sha256 = contractSha256(contract);
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

const SHA256_HEX = /^[a-f0-9]{64}$/;

function assertDraftPayloadShape(payload: DraftLegislationPayload): void {
  if (!SHA256_HEX.test(payload.interrogation_sha256)) {
    throw new DraftTokenError(
      "TOKEN_MALFORMED",
      `${CLI_NAME} draft token interrogation_sha256 must be 64 hex chars`,
      false,
    );
  }
  if (!Array.isArray(payload.interrogation)) {
    throw new DraftTokenError("TOKEN_MALFORMED", `${CLI_NAME} draft token interrogation must be an array`, false);
  }
  if (!Array.isArray(payload.declared_paths)) {
    throw new DraftTokenError(
      "TOKEN_MALFORMED",
      `${CLI_NAME} draft token declared_paths must be an array`,
      false,
    );
  }
  if (payload.gate_adapter !== undefined && !isGateAdapterId(payload.gate_adapter)) {
    throw new DraftTokenError(
      "TOKEN_MALFORMED",
      `${CLI_NAME} draft token gate_adapter must be generic|eslint|tsc`,
      false,
    );
  }
  if (payload.v === 2 && (payload.contract !== undefined || payload.contract_sha256 !== undefined)) {
    throw new DraftTokenError("TOKEN_MALFORMED", `${CLI_NAME} draft token v2 cannot carry a contract (require v3)`, false);
  }
  if (payload.v === 3 && payload.contract) {
    const expected = contractSha256(normalizeContract(payload.contract));
    if (payload.contract_sha256 !== expected) {
      throw new DraftTokenError("TOKEN_MALFORMED", `${CLI_NAME} draft token contract_sha256 does not match contract`, false);
    }
  }
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

  if (payload.v !== 2 && payload.v !== 3) {
    throw new DraftTokenError("TOKEN_MALFORMED", `${CLI_NAME} draft token version unsupported (require v2 or v3)`, false);
  }

  assertDraftPayloadShape(payload);

  return withState(root, (state, write) => {
    if (!state) {
      throw new DraftTokenError("TOKEN_KEY_MISSING", `${CLI_NAME} draft token key missing in ~/${GANTRY_STATE_HOME_REL}; re-run gxt_draft_legislation`, false);
    }
    const expectedSig = signPayload(payload, base64UrlDecode(state.key));
    const expectedBuf = Buffer.from(expectedSig, "utf8");
    const providedBuf = Buffer.from(parts[1]!, "utf8");
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

    if (state.used.some((u) => u.id === payload.draft_id)) {
      throw new DraftTokenError("TOKEN_REPLAYED", `${CLI_NAME} draft token already executed`, true);
    }

    if (options?.consume !== false) {
      // An expired id can never verify again, so only expired entries are dropped.
      const used = [...state.used.filter((u) => u.exp >= now), { id: payload.draft_id, exp: payload.exp }];
      write({ ...state, used });
    }
    return payload;
  });
}
