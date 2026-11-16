/**
 * MSN-0381 (issue #356, ADR-0063 Q10): the draft-token HMAC key lives in the per-user state dir, outside the repository.
 * The old attack read `.gitagent/foreman/DRAFT_TOKEN.key` and signed its own draft; that key is now refused.
 */
import test, { mock } from "node:test";
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

function withStateDir<T>(dir: string, fn: () => T): T {
  const prev = process.env.GANTRY_STATE_DIR;
  process.env.GANTRY_STATE_DIR = dir;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.GANTRY_STATE_DIR;
    else process.env.GANTRY_STATE_DIR = prev;
  }
}

test("draft token: a state dir reached through a link into the repository, or named ..x inside it, is refused", () => {
  const dest = repo("og-auth-statelink-");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "og-auth-statelink-out-"));
  fs.symlinkSync(dest, path.join(outside, "link"));
  withStateDir(path.join(outside, "link", "state"), () => assert.throws(() => draft(dest), code("TOKEN_STATE_INVALID"), "the missing state dir resolves through the link"));
  assert.equal(fs.existsSync(path.join(dest, "state")), false, "no key written into the repository");
  withStateDir(path.join(dest, "..cache"), () => assert.throws(() => draft(dest), code("TOKEN_STATE_INVALID"), "..cache is a child of the repository"));
  assert.equal(fs.existsSync(path.join(dest, "..cache")), false);
  const sibling = fs.mkdtempSync(path.join(os.tmpdir(), "og-auth-statelink-ok-"));
  withStateDir(path.join(sibling, "nested", "state"), () => assert.ok(draft(dest), "a missing dir outside the repository is fine"));
});

const stateFileIn = (dir: string): string => path.join(dir, "draft-token.json");
const owner = (token: string): string => `${JSON.stringify({ token, pid: 1 })}\n`;

test("draft token lock: a stale lock is taken over; the lock is gone afterwards", () => {
  const dest = repo("og-auth-lock-stale-");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-auth-lock-stale-state-"));
  withStateDir(dir, () => {
    const lock = `${stateFileIn(dir)}.lock`;
    fs.writeFileSync(lock, owner("crashed"));
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, old, old);
    assert.ok(draft(dest));
    assert.equal(fs.existsSync(lock), false);
    assert.deepEqual(fs.readdirSync(dir).sort(), ["draft-token.json"], "no aside or temporary file left");
  });
});

test("draft token lock: a writer that lost its lock while paused refuses and leaves the new owner's lock in place", () => {
  const dest = repo("og-auth-lock-paused-");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-auth-lock-paused-state-"));
  withStateDir(dir, () => {
    const token = draft(dest);
    const lock = `${stateFileIn(dir)}.lock`;
    const before = fs.readFileSync(stateFileIn(dir), "utf8");
    // While this writer is paused past the stale age, another process takes the lock over.
    const real = fs.writeFileSync.bind(fs);
    const spy = mock.method(fs, "writeFileSync", (file: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, opts?: fs.WriteFileOptions) => {
      if (typeof file === "string" && file.endsWith(".tmp")) real(lock, owner("the-new-owner"));
      real(file, data, opts);
    });
    try {
      assert.throws(() => verifyDraftToken(dest, token, { consume: true }), (e: unknown) => code("TOKEN_STATE_INVALID")(e) && /ownership/.test((e as Error).message));
    } finally {
      spy.mock.restore();
    }
    assert.equal(fs.readFileSync(stateFileIn(dir), "utf8"), before, "the stale writer wrote nothing");
    assert.equal(fs.readFileSync(lock, "utf8"), owner("the-new-owner"), "the new owner's lock is not removed");
    fs.rmSync(lock);
    assert.equal(verifyDraftToken(dest, token, { consume: true }).msn_id, "MSN-0101", "the token was not consumed by the refused writer");
  });
});

test("draft token lock: an error other than an existing lock is reported, not taken for a lock", { skip: process.platform === "win32" || process.getuid?.() === 0 }, () => {
  const dest = repo("og-auth-lock-eacces-");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-auth-lock-eacces-state-"));
  withStateDir(dir, () => {
    draft(dest);
    fs.chmodSync(dir, 0o500);
    try {
      const started = Date.now();
      assert.throws(() => draft(dest), (e: unknown) => (e as NodeJS.ErrnoException).code === "EACCES");
      assert.ok(Date.now() - started < 4000, "no wait for a lock that does not exist");
    } finally {
      fs.chmodSync(dir, 0o700);
    }
  });
});

test("draft token lock: a live lock held by another owner refuses after the bounded wait", () => {
  const dest = repo("og-auth-lock-live-");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-auth-lock-live-state-"));
  withStateDir(dir, () => {
    draft(dest);
    const lock = `${stateFileIn(dir)}.lock`;
    fs.writeFileSync(lock, owner("alive"));
    assert.throws(() => draft(dest), (e: unknown) => code("TOKEN_STATE_INVALID")(e) && /locked by another process/.test((e as Error).message));
    assert.equal(fs.readFileSync(lock, "utf8"), owner("alive"), "a live lock is never removed");
  });
});
