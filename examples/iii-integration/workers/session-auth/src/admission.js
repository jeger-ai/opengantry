/**
 * Example admission worker — NOT OpenGantry.
 * Replace `session::auth` with your IdP / platform auth in production config.
 */
import crypto from "node:crypto";

const DEFAULT_SECRET = "iii-integration-session-dev-secret";

function getSecret() {
  return process.env.GXT_SESSION_SECRET?.trim() || DEFAULT_SECRET;
}

export function mintSessionAdmissionToken(payload) {
  const body = {
    msn_id: payload.msn_id,
    holder_id: payload.holder_id,
    worktree_path: payload.worktree_path,
    nonce: crypto.randomBytes(16).toString("hex"),
    exp: Math.floor(Date.now() / 1000) + (payload.ttlSeconds ?? 3600),
  };
  const message = [
    body.msn_id,
    body.worktree_path,
    body.holder_id,
    body.nonce,
    String(body.exp),
  ].join("\x1f");
  const hmac = crypto
    .createHmac("sha256", getSecret())
    .update(message, "utf8")
    .digest("hex");
  return Buffer.from(JSON.stringify({ body, hmac }), "utf8").toString("base64url");
}

export function verifySessionAdmissionToken(token) {
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    const body = parsed.body;
    const hmac = parsed.hmac;
    if (!body || typeof hmac !== "string") return null;
    if (body.exp < Math.floor(Date.now() / 1000)) return null;
    const message = [
      body.msn_id,
      body.worktree_path,
      body.holder_id,
      body.nonce,
      String(body.exp),
    ].join("\x1f");
    const expected = crypto
      .createHmac("sha256", getSecret())
      .update(message, "utf8")
      .digest("hex");
    if (expected.length !== hmac.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(hmac, "hex"))) {
      return null;
    }
    return {
      msn_id: body.msn_id,
      holder_id: body.holder_id,
      worktree_path: body.worktree_path,
    };
  } catch {
    return null;
  }
}

export function extractBearer(headers) {
  const auth = headers?.authorization ?? headers?.Authorization ?? "";
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}
