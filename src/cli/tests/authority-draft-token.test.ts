/**
 * MSN-0381 (issue #356, ADR-0063 Q10): the draft-token HMAC key lives in the per-user state dir, outside the repository.
 * The old attack read `.gitagent/foreman/DRAFT_TOKEN.key` and signed its own draft; that key is now refused.
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { createDraftToken, verifyDraftToken, DraftTokenError } from "#missions/draft-token.js";
import { canonicalJson } from "#core/canonical-json.js";
import { emptyDraftTokenInterrogationFields } from "./test-fixtures.js";

function repo(prefix: string): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(dest, "README.md"), "fixture\n");
  execSync("git init -q && git config user.email t@example.com && git config user.name T && git add . && git commit -qm init", { cwd: dest, stdio: "pipe" });
  return dest;
}

function draft(dest: string): string {
  return createDraftToken(dest, { title: "Add hover state", msn_id: "MSN-0101", skill_key: "gantry", gate_command: "npm test", ...emptyDraftTokenInterrogationFields() }).draft_token;
}

/** What an agent that can read a key does: re-sign a payload of its choice with that key. */
function forge(token: string, key: Buffer, change: Record<string, unknown>): string {
  const payload = { ...(JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8")) as Record<string, unknown>), ...change };
  const sig = crypto.createHmac("sha256", key).update(canonicalJson(payload), "utf8").digest("base64url");
  return `${Buffer.from(canonicalJson(payload), "utf8").toString("base64url")}.${sig}`;
}

// test-tmpdir-setup points GANTRY_STATE_DIR at the run's temporary directory. CI's plain `node --test` run has no
// preload, so set one here too: these tests must never touch the real ~/.opengantry.
process.env.GANTRY_STATE_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "og-auth-state-"));
const stateDir = (): string => process.env.GANTRY_STATE_DIR!;
const code = (c: string) => (e: unknown) => e instanceof DraftTokenError && e.code === c;

test("draft token: the key is written to the per-user state dir, never into the repository", () => {
  const dest = repo("og-auth-key-");
  draft(dest);
  assert.equal(fs.existsSync(path.join(dest, ".gitagent", "foreman", "DRAFT_TOKEN.key")), false);
  const rel = path.relative(fs.realpathSync(dest), fs.realpathSync(stateDir()));
  assert.ok(rel.startsWith("..") || path.isAbsolute(rel), "state dir is outside the repository");
  const state = JSON.parse(fs.readFileSync(path.join(stateDir(), "draft-token.json"), "utf8")) as { key: string };
  assert.ok(Buffer.from(state.key, "base64url").length >= 32);
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(stateDir(), "draft-token.json")).mode & 0o077, 0, "owner-only file");
});

test("draft token: a draft signed with an agent-readable in-repo key is refused (the old attack)", () => {
  const dest = repo("og-auth-legacy-");
  const legit = draft(dest);
  const legacyKey = crypto.randomBytes(32);
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.writeFileSync(path.join(dest, ".gitagent", "foreman", "DRAFT_TOKEN.key"), legacyKey);
  const forged = forge(legit, legacyKey, { draft_id: crypto.randomUUID(), title: "self-approved" });
  assert.throws(() => verifyDraftToken(dest, forged, { consume: true }), code("TOKEN_LEGACY_KEY"));
  assert.throws(() => verifyDraftToken(dest, legit, { consume: false }), code("TOKEN_LEGACY_KEY"), "nothing verifies while the legacy key is present");
  assert.throws(() => draft(dest), code("TOKEN_LEGACY_KEY"), "the operator is told before anything is signed");
  fs.rmSync(path.join(dest, ".gitagent", "foreman", "DRAFT_TOKEN.key"));
  assert.throws(() => verifyDraftToken(dest, forged, { consume: true }), code("TOKEN_SIGNATURE_INVALID"), "the old key never signs again");
  assert.equal(verifyDraftToken(dest, legit, { consume: false }).msn_id, "MSN-0101");
});

test("draft token: the replay ledger cannot be reset from the repository; deleting or corrupting the state refuses", () => {
  const dest = repo("og-auth-replay-");
  const token = draft(dest);
  verifyDraftToken(dest, token, { consume: true });
  fs.rmSync(path.join(dest, ".gitagent", "history"), { recursive: true, force: true });
  assert.throws(() => verifyDraftToken(dest, token, { consume: true }), code("TOKEN_REPLAYED"), "the old in-repo ledger path holds nothing");

  const stateFile = path.join(stateDir(), "draft-token.json");
  const kept = fs.readFileSync(stateFile, "utf8");
  for (const bad of ["{not json", "null", "[]", JSON.stringify({ ...(JSON.parse(kept) as object), used: "none" })]) {
    fs.writeFileSync(stateFile, bad);
    assert.throws(() => verifyDraftToken(dest, token, { consume: true }), code("TOKEN_STATE_INVALID"), `a corrupt ledger never reads as empty: ${bad.slice(0, 20)}`);
  }
  assert.throws(() => draft(dest), code("TOKEN_STATE_INVALID"));

  fs.rmSync(stateFile);
  assert.throws(() => verifyDraftToken(dest, token, { consume: true }), code("TOKEN_KEY_MISSING"), "deleting the ledger deletes the key");
  draft(dest);
  assert.throws(() => verifyDraftToken(dest, token, { consume: true }), code("TOKEN_SIGNATURE_INVALID"), "a fresh key never accepts an old draft");
});

test("draft token: a state dir inside the repository or a relative one is refused", () => {
  const dest = repo("og-auth-statedir-");
  const prev = process.env.GANTRY_STATE_DIR;
  try {
    process.env.GANTRY_STATE_DIR = path.join(dest, ".gitagent", "history", "state");
    assert.throws(() => draft(dest), code("TOKEN_STATE_INVALID"));
    process.env.GANTRY_STATE_DIR = "relative/state";
    assert.throws(() => draft(dest), code("TOKEN_STATE_INVALID"));
  } finally {
    if (prev === undefined) delete process.env.GANTRY_STATE_DIR;
    else process.env.GANTRY_STATE_DIR = prev;
  }
});
