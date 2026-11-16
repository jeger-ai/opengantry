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
import { execSync, spawn } from "node:child_process";
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

test("draft token lock: an old lock is never taken over; it refuses with TOKEN_STATE_LOCKED naming the path (review round 2)", () => {
  const dest = repo("og-auth-lock-stale-");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-auth-lock-stale-state-"));
  withStateDir(dir, () => {
    const token = draft(dest);
    const before = fs.readFileSync(stateFileIn(dir), "utf8");
    const lock = `${stateFileIn(dir)}.lock`;
    fs.writeFileSync(lock, owner("crashed"));
    const old = new Date(Date.now() - 24 * 3600_000);
    fs.utimesSync(lock, old, old);
    assert.throws(() => verifyDraftToken(dest, token, { consume: true }), (e: unknown) => {
      const m = (e as Error).message;
      return code("TOKEN_STATE_LOCKED")(e) && m.includes(lock) && /delete it only if no gantry process is running/.test(m);
    });
    assert.equal(fs.readFileSync(lock, "utf8"), owner("crashed"), "the lock is left for the operator");
    assert.equal(fs.readFileSync(stateFileIn(dir), "utf8"), before, "nothing consumed");
    fs.rmSync(lock); // what the operator does once no gantry process runs
    assert.equal(verifyDraftToken(dest, token, { consume: true }).msn_id, "MSN-0101");
    assert.deepEqual(fs.readdirSync(dir).sort(), ["draft-token.json"], "no lock or temporary file left");
  });
});

/** Run `during` once, inside the next call's critical section (right when it reads the state file). */
function insideCriticalSection(dir: string, during: () => void): { restore: () => void } {
  const real = fs.readFileSync.bind(fs) as (...a: unknown[]) => unknown;
  let fired = false;
  const spy = mock.method(fs, "readFileSync", (...args: unknown[]) => {
    if (!fired && args[0] === stateFileIn(dir)) {
      fired = true;
      during();
    }
    return real(...args);
  });
  return { restore: () => spy.mock.restore() };
}

test("draft token lock: a second consumer while the first holds the lock refuses; the token is consumed once", () => {
  const dest = repo("og-auth-lock-interleave-");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-auth-lock-interleave-state-"));
  withStateDir(dir, () => {
    const token = draft(dest);
    let second: unknown = null;
    const hook = insideCriticalSection(dir, () => {
      try {
        verifyDraftToken(dest, token, { consume: true });
        second = "ok";
      } catch (e) {
        second = e;
      }
    });
    try {
      assert.equal(verifyDraftToken(dest, token, { consume: true }).msn_id, "MSN-0101", "the holder succeeds");
    } finally {
      hook.restore();
    }
    assert.ok(code("TOKEN_STATE_LOCKED")(second), "the consumer that came in while the lock was held refused");
    assert.throws(() => verifyDraftToken(dest, token, { consume: true }), code("TOKEN_REPLAYED"));
  });
});

test("draft token lock: a lock replaced while held refuses the write, is left in place, and the original error survives a failed release", () => {
  const dest = repo("og-auth-lock-paused-");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-auth-lock-paused-state-"));
  withStateDir(dir, () => {
    const token = draft(dest);
    const lock = `${stateFileIn(dir)}.lock`;
    const before = fs.readFileSync(stateFileIn(dir), "utf8");
    const stderr = mock.method(process.stderr, "write", () => true);
    // Someone removed the lock by hand and another process took a new one.
    const hook = insideCriticalSection(dir, () => fs.writeFileSync(lock, owner("the-new-owner")));
    try {
      assert.throws(() => verifyDraftToken(dest, token, { consume: true }), (e: unknown) => code("TOKEN_STATE_INVALID")(e) && /ownership/.test((e as Error).message) && (e as { lockReleaseError?: unknown }).lockReleaseError instanceof Error);
      // fn's own error (a bad signature) is the one thrown, not the release failure.
      fs.rmSync(lock);
      const hook2 = insideCriticalSection(dir, () => fs.writeFileSync(lock, owner("another")));
      try {
        assert.throws(() => verifyDraftToken(dest, `${token.split(".")[0]!}.AAAA`, { consume: true }), code("TOKEN_SIGNATURE_INVALID"));
      } finally {
        hook2.restore();
      }
      assert.ok(stderr.mock.calls.some((c) => /lock release failed/.test(String(c.arguments[0]))), "the release failure is reported");
    } finally {
      hook.restore();
      stderr.mock.restore();
    }
    assert.equal(fs.readFileSync(stateFileIn(dir), "utf8"), before, "the refused writer wrote nothing");
    assert.equal(fs.readFileSync(lock, "utf8"), owner("another"), "a lock this call does not own is never removed");
    fs.rmSync(lock);
    assert.equal(verifyDraftToken(dest, token, { consume: true }).msn_id, "MSN-0101", "the token was not consumed by the refused writer");
  });
});

test("draft token: the new state is fsynced before it is renamed into place", () => {
  const dest = repo("og-auth-fsync-");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-auth-fsync-state-"));
  withStateDir(dir, () => {
    const token = draft(dest);
    const order: string[] = [];
    const realFsync = fs.fsyncSync.bind(fs);
    const realRename = fs.renameSync.bind(fs);
    const f = mock.method(fs, "fsyncSync", (fd: number) => (order.push("fsync"), realFsync(fd)));
    const r = mock.method(fs, "renameSync", (a: fs.PathLike, b: fs.PathLike) => (order.push("rename"), realRename(a, b)));
    try {
      verifyDraftToken(dest, token, { consume: true });
    } finally {
      f.mock.restore();
      r.mock.restore();
    }
    assert.deepEqual(order, ["fsync", "rename"]);
  });
});

test("draft token lock: concurrent processes consuming one token produce exactly one success", async () => {
  const dest = repo("og-auth-lock-procs-");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-auth-lock-procs-state-"));
  const token = withStateDir(dir, () => draft(dest));
  const mod = new URL("../../packages/missions/src/draft-token.js", import.meta.url).href;
  const script = `import { verifyDraftToken } from ${JSON.stringify(mod)};
try { verifyDraftToken(process.argv[1], process.argv[2], { consume: true }); console.log("ok"); } catch (e) { console.log(e.code ?? String(e)); }`;
  const run = (): Promise<string> =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script, dest, token], { env: { ...process.env, GANTRY_STATE_DIR: dir }, stdio: ["ignore", "pipe", "inherit"] });
      let out = "";
      child.stdout.on("data", (d: Buffer) => (out += d.toString()));
      child.on("close", () => resolve(out.trim()));
    });
  const outcomes = await Promise.all(Array.from({ length: 8 }, run));
  assert.equal(outcomes.filter((o) => o === "ok").length, 1, outcomes.join(","));
  assert.ok(outcomes.every((o) => ["ok", "TOKEN_REPLAYED", "TOKEN_STATE_LOCKED"].includes(o)), outcomes.join(","));
  assert.deepEqual(fs.readdirSync(dir).sort(), ["draft-token.json"]);
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
      assert.ok(Date.now() - started < 1500, "no wait for a lock that does not exist");
    } finally {
      fs.chmodSync(dir, 0o700);
    }
  });
});

test("draft token lock: a live lock held by another owner refuses with TOKEN_STATE_LOCKED after the bounded wait", () => {
  const dest = repo("og-auth-lock-live-");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-auth-lock-live-state-"));
  withStateDir(dir, () => {
    draft(dest);
    const lock = `${stateFileIn(dir)}.lock`;
    fs.writeFileSync(lock, owner("alive"));
    assert.throws(() => draft(dest), code("TOKEN_STATE_LOCKED"));
    assert.equal(fs.readFileSync(lock, "utf8"), owner("alive"), "a live lock is never removed");
  });
});
