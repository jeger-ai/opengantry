import crypto from "node:crypto";

import { GantryUserError } from "./errors.js";
import { filterEpochs, getPeppersForOrg, loadPepperKeyring, listOrgIds } from "./pepper-keyring.js";
import { hmacSha256Hex } from "./receipt-attribution.js";

export const VERDICT_TOKEN_SCHEMA_VERSION = 1 as const;

export interface VerdictTokenPayload {
  schema_version: typeof VERDICT_TOKEN_SCHEMA_VERSION;
  msn_id: string;
  mission_sha256: string;
  findings_digest: string;
  gate_command: string;
  org_id: string;
  pepper_version: number;
  exp: number;
  nonce: string;
}

export interface MintVerdictTokenInput {
  msn_id: string;
  mission_sha256: string;
  findings_digest: string;
  gate_command: string;
  org_id: string;
  keyringPath?: string;
  ttlSeconds?: number;
}

export interface VerifyVerdictTokenInput {
  token: string;
  expected: {
    msn_id: string;
    mission_sha256: string;
    findings_digest: string;
    gate_command: string;
    org_id: string;
  };
  keyringPath?: string;
}

function canonicalVerdictMessage(payload: Omit<VerdictTokenPayload, "pepper_version">): string {
  return [
    `v${payload.schema_version}`,
    payload.msn_id,
    payload.mission_sha256,
    payload.findings_digest,
    payload.gate_command,
    payload.org_id,
    payload.exp,
    payload.nonce,
  ].join("\x1f");
}

function encodeToken(payload: VerdictTokenPayload, hmac: string): string {
  const body = JSON.stringify({ payload, hmac });
  return Buffer.from(body, "utf8").toString("base64url");
}

function decodeToken(token: string): { payload: VerdictTokenPayload; hmac: string } {
  try {
    const raw = Buffer.from(token, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as { payload?: VerdictTokenPayload; hmac?: string };
    if (!parsed.payload || typeof parsed.hmac !== "string") {
      throw new Error("invalid shape");
    }
    return { payload: parsed.payload, hmac: parsed.hmac };
  } catch {
    throw new GantryUserError("VERDICT_TOKEN_INVALID", "verdict token is not valid base64url JSON", undefined, 2);
  }
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function mintVerdictToken(input: MintVerdictTokenInput): string {
  const entries = loadPepperKeyring(input.keyringPath);
  const orgPeppers = getPeppersForOrg(entries, input.org_id);
  if (orgPeppers.length === 0) {
    const available = listOrgIds(entries);
    throw new GantryUserError(
      "ORG_ID_UNKNOWN",
      `no peppers for org_id: ${input.org_id}`,
      available.length > 0 ? `available: ${available.join(", ")}` : undefined,
      2,
    );
  }
  const peppers = filterEpochs(orgPeppers, "current");
  const pepper = peppers[peppers.length - 1]!;
  const ttl = input.ttlSeconds ?? 3600;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload: VerdictTokenPayload = {
    schema_version: VERDICT_TOKEN_SCHEMA_VERSION,
    msn_id: input.msn_id,
    mission_sha256: input.mission_sha256,
    findings_digest: input.findings_digest,
    gate_command: input.gate_command,
    org_id: input.org_id,
    pepper_version: pepper.pepper_version,
    exp,
    nonce,
  };
  const message = canonicalVerdictMessage(payload);
  const hmac = hmacSha256Hex(pepper.pepper, message);
  return encodeToken({ ...payload, pepper_version: pepper.pepper_version }, hmac);
}

export function verifyVerdictToken(input: VerifyVerdictTokenInput): boolean {
  const { payload, hmac } = decodeToken(input.token);
  if (payload.schema_version !== VERDICT_TOKEN_SCHEMA_VERSION) return false;
  if (payload.msn_id !== input.expected.msn_id) return false;
  if (payload.mission_sha256 !== input.expected.mission_sha256) return false;
  if (payload.findings_digest !== input.expected.findings_digest) return false;
  if (payload.gate_command !== input.expected.gate_command) return false;
  if (payload.org_id !== input.expected.org_id) return false;
  if (payload.exp < Math.floor(Date.now() / 1000)) return false;

  const entries = loadPepperKeyring(input.keyringPath);
  const orgPeppers = getPeppersForOrg(entries, input.expected.org_id);
  const pepper = orgPeppers.find((p) => p.pepper_version === payload.pepper_version);
  if (!pepper) return false;

  const message = canonicalVerdictMessage(payload);
  const expectedHmac = hmacSha256Hex(pepper.pepper, message);
  return timingSafeEqualHex(hmac, expectedHmac);
}
