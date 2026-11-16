/**
 * MSN-0385 (issue #356, follow-up of MSN-0381): CI counted any well-formed gxt-bypass note, so a candidate that never
 * knew the break-glass secret could write `{ v: 1, reason }` on its own commit and pass `gantry ci msn-range`. A note
 * now counts only when it is version 2, names the noted commit, and is SSH-signed by a key the base commit's
 * PLANNER.signing.pub lists for its signer. CI holds no secret; the Planner key is the proof.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { canonicalJson } from "#core/canonical-json.js";
import { getRepoRoot, gitChildEnv } from "#git/git.js";
import { writeBypassGitNote } from "#missions/break-glass.js";
import { sshSignWithGitKey } from "#git/receipt-signing.js";
import { writeBypassAnchor, writeMiniGantryRepo } from "./test-fixtures.js";
import { PLANNER_EMAIL } from "./test-shared.js";

const OG = getRepoRoot();
const CLI = path.join(OG, "dist", "cli", "index.js");
const SECRET = "team-break-glass-secret-0385";
const NAMESPACE = "opengantry-break-glass";
const noSshKeygen = spawnSync("ssh-keygen", ["-?"]).error ? "ssh-keygen not available" : false;

function git(dest: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", dest, ...args], { encoding: "utf8", env: gitChildEnv() });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function newKey(dir: string, name: string): { priv: string; pub: string } {
  const priv = path.join(dir, name);
  assert.equal(spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", name, "-f", priv]).status, 0);
  return { priv, pub: fs.readFileSync(`${priv}.pub`, "utf8").trim().split(" ").slice(0, 2).join(" ") };
}

function sshSign(priv: string, message: string, namespace = NAMESPACE): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "og-note-msg-")), "m");
  fs.writeFileSync(file, message);
  assert.equal(spawnSync("ssh-keygen", ["-Y", "sign", "-f", priv, "-n", namespace, file]).status, 0);
  return fs.readFileSync(`${file}.sig`, "utf8");
}

/** A signed v2 note as the break-glass writer makes it, for `commit`, with the key `priv`. */
function note(priv: string, commit: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const body = { v: 2, reason: "production outage requires hotfix", ts: "2026-11-16T00:00:00.000Z", commit, signer: PLANNER_EMAIL, ...over };
  return { ...body, signature: sshSign(priv, canonicalJson(body)) };
}

/**
 * The base commit on main lists the Planner key and the anchor; the candidate's commit on a feature branch touches an
 * MSN-enforced path without an [MSN] subject.
 */
function fixture(): { dest: string; base: string; head: string; planner: { priv: string; pub: string }; keys: string } {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-bypass-note-"));
  const keys = fs.mkdtempSync(path.join(os.tmpdir(), "og-bypass-keys-"));
  const planner = newKey(keys, "planner");
  writeMiniGantryRepo(dest, OG);
  writeBypassAnchor(dest, SECRET);
  fs.writeFileSync(path.join(dest, ".gitagent", "foreman", "PLANNER.signing.pub"), `${PLANNER_EMAIL} ${planner.pub}\n`);
  git(dest, "init", "-q", "-b", "main");
  git(dest, "config", "user.email", PLANNER_EMAIL);
  git(dest, "config", "user.name", "Fixture");
  git(dest, "add", "-A");
  git(dest, "commit", "-qm", "[MSN-0999] base");
  const base = git(dest, "rev-parse", "HEAD");
  git(dest, "checkout", "-qb", "feature");
  fs.writeFileSync(path.join(dest, ".gitagent", "touch.txt"), "x\n");
  git(dest, "add", "-A");
  git(dest, "commit", "-qm", "hotfix without a mission");
  return { dest, base, head: git(dest, "rev-parse", "HEAD"), planner, keys };
}

function msnRange(dest: string, base: string, head: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [CLI, "ci", "msn-range", "--base", base, "--head", head], { cwd: dest, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

test("bypass note: a well-formed unsigned v1 note no longer passes CI (the old forgery)", { skip: noSshKeygen }, () => {
  const { dest, base, head } = fixture();
  writeBypassGitNote(dest, head, { v: 1, reason: "emergency hotfix documented in note", ts: new Date().toISOString(), msn_id: "MSN-0999" });
  const r = msnRange(dest, base, head);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /MSN check FAILED/);
  assert.match(r.out, /gxt-bypass note: the gxt-bypass note is version 1, unsigned, which no longer counts/);
});

test("bypass note: forged v2 notes are refused (own key, own key added on the branch, replayed, edited, wrong namespace)", { skip: noSshKeygen }, () => {
  const { dest, base, head, planner, keys } = fixture();
  const attacker = newKey(keys, "attacker");
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ["the candidate's own key", note(attacker.priv, head), /not in the allowed signers/],
    ["a Planner-signed note for another commit", note(planner.priv, base), /names another commit/],
    ["a Planner-signed note with its reason edited", { ...note(planner.priv, head), reason: "something else entirely here" }, /does not verify/],
    ["a Planner key signature for another namespace", (() => {
      const body = { v: 2, reason: "production outage requires hotfix", ts: "2026-11-16T00:00:00.000Z", commit: head, signer: PLANNER_EMAIL };
      return { ...body, signature: sshSign(planner.priv, canonicalJson(body), "git") };
    })(), /namespace/],
    ["a Planner-signed note naming another signer", note(planner.priv, head, { signer: "someone@example.test" }), /not listed for someone@example\.test/],
    ["a note with no signature", (() => { const { signature: _s, ...rest } = note(planner.priv, head); return rest; })(), /no signer and signature/],
  ];
  for (const [what, n, why] of cases) {
    writeBypassGitNote(dest, head, n);
    const r = msnRange(dest, base, head);
    assert.notEqual(r.status, 0, what);
    assert.match(r.out, why, what);
  }
  // The candidate lists its own key on the branch and signs only the commit that adds it; the earlier commit carries a
  // valid Planner note. Keys read from each commit's own tree would pass both; the keys come from the base, so the
  // commit that adds the key fails and it is the one CI names.
  fs.appendFileSync(path.join(dest, ".gitagent", "foreman", "PLANNER.signing.pub"), `${PLANNER_EMAIL} ${attacker.pub}\n`);
  git(dest, "commit", "-qam", "add my key");
  const head2 = git(dest, "rev-parse", "HEAD");
  writeBypassGitNote(dest, head, note(planner.priv, head));
  writeBypassGitNote(dest, head2, note(attacker.priv, head2));
  assert.equal(msnRange(dest, base, head).status, 0, "the Planner-signed commit alone passes");
  const r = msnRange(dest, base, head2);
  assert.notEqual(r.status, 0);
  assert.match(r.out, new RegExp(`commit ${head2} touches MSN-enforced paths`));
  assert.match(r.out, /not in the allowed signers/);
});

function breakGlass(dest: string, extraGitConfig: [string, string][]): { status: number | null; out: string } {
  for (const [k, v] of extraGitConfig) git(dest, "config", k, v);
  const env = { ...process.env, NO_COLOR: "1", GANTRY_BYPASS_SECRET: SECRET };
  const r = spawnSync(process.execPath, [CLI, "verify", "--mission", ".gitagent/missions/m.yaml", "--break-glass", "--reason", "production outage requires hotfix"], { cwd: dest, encoding: "utf8", env });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

test("bypass note: gantry verify --break-glass with the Planner's SSH key writes a note CI accepts", { skip: noSshKeygen }, () => {
  const { dest, base, head, planner } = fixture();
  const r = breakGlass(dest, [["gpg.format", "ssh"], ["user.signingkey", planner.priv]]);
  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /CI will refuse/);
  const written = JSON.parse(git(dest, "notes", "--ref=refs/notes/gxt-bypass", "show", head)) as Record<string, unknown>;
  assert.equal(written.v, 2);
  assert.equal(written.commit, head);
  assert.equal(written.signer, PLANNER_EMAIL);
  const ok = msnRange(dest, base, head);
  assert.equal(ok.status, 0, ok.out);
  assert.match(ok.out, /MSN commit subjects OK/);
});

test("bypass note: the local warning reads the Planner keys at the default branch tip, which CI's base is, not the merge-base", { skip: noSshKeygen }, () => {
  const { dest, head, keys, planner } = fixture();
  // A key the Planner listed on main after the feature branch forked: CI (base = main's tip) accepts a note it signs.
  const late = newKey(keys, "late-planner");
  git(dest, "checkout", "-q", "main");
  fs.appendFileSync(path.join(dest, ".gitagent", "foreman", "PLANNER.signing.pub"), `${PLANNER_EMAIL} ${late.pub}\n`);
  git(dest, "commit", "-qam", "[MSN-0999] list a second Planner key");
  const tip = git(dest, "rev-parse", "HEAD");
  git(dest, "checkout", "-q", "feature");
  const r = breakGlass(dest, [["gpg.format", "ssh"], ["user.signingkey", late.priv]]);
  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /CI will refuse/, "the key is a Planner key at main's tip");
  const ci = msnRange(dest, tip, head);
  assert.equal(ci.status, 0, ci.out);
  // The other way round: a key main dropped after the fork is warned, although the merge-base still lists it.
  git(dest, "checkout", "-q", "main");
  fs.writeFileSync(path.join(dest, ".gitagent", "foreman", "PLANNER.signing.pub"), `${PLANNER_EMAIL} ${late.pub}\n`);
  git(dest, "commit", "-qam", "[MSN-0999] retire the first Planner key");
  git(dest, "checkout", "-q", "feature");
  const warned = breakGlass(dest, [["user.signingkey", planner.priv]]);
  assert.equal(warned.status, 0, warned.out);
  assert.match(warned.out, /CI will refuse this note/);
});

test("bypass note: break-glass without an SSH signing key refuses and writes no note; a non-Planner key is warned", { skip: noSshKeygen }, () => {
  const { dest, head, keys } = fixture();
  const none = breakGlass(dest, []);
  assert.equal(none.status, 2, none.out);
  assert.match(none.out, /BYPASS_SIGNING_UNAVAILABLE/);
  assert.notEqual(spawnSync("git", ["-C", dest, "notes", "--ref=refs/notes/gxt-bypass", "show", head], { env: gitChildEnv() }).status, 0, "no note");
  const other = newKey(keys, "other");
  const warned = breakGlass(dest, [["gpg.format", "ssh"], ["user.signingkey", other.priv]]);
  assert.equal(warned.status, 0, warned.out);
  assert.match(warned.out, /CI will refuse this note: .*not in the allowed signers/);
});

const noAgent = noSshKeygen || (spawnSync("ssh-agent", ["-h"]).error ? "ssh-agent not available" : false);

/** A temporary ssh-agent holding `priv`; the caller kills it. */
function agentWith(priv: string): { sock: string; pid: string } {
  const out = spawnSync("ssh-agent", ["-s", "-a", path.join(fs.mkdtempSync(path.join(os.tmpdir(), "og-agent-")), "s")], { encoding: "utf8" }).stdout;
  const sock = /SSH_AUTH_SOCK=([^;]+);/.exec(out)?.[1];
  const pid = /SSH_AGENT_PID=(\d+);/.exec(out)?.[1];
  assert.ok(sock && pid, out);
  assert.equal(spawnSync("ssh-add", ["-q", priv], { env: { ...process.env, SSH_AUTH_SOCK: sock }, encoding: "utf8" }).status, 0);
  return { sock, pid };
}

function verifies(pub: string, message: string, signature: string): boolean {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-agent-verify-"));
  fs.writeFileSync(path.join(dir, "allowed"), `${PLANNER_EMAIL} ${pub}\n`);
  fs.writeFileSync(path.join(dir, "sig"), signature);
  return spawnSync("ssh-keygen", ["-Y", "verify", "-f", path.join(dir, "allowed"), "-I", PLANNER_EMAIL, "-n", NAMESPACE, "-s", path.join(dir, "sig")], { input: message }).status === 0;
}

test("bypass note: the git signing key signs as a .pub through ssh-agent and as a key:: literal, as git accepts", { skip: noAgent }, () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-agent-repo-"));
  git(dest, "init", "-q");
  git(dest, "config", "gpg.format", "ssh");
  const k = newKey(fs.mkdtempSync(path.join(os.tmpdir(), "og-agent-keys-")), "agent-planner");
  // Only the public half is on disk where git looks; the private key lives in the agent.
  const pubOnly = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "og-agent-pub-")), "id.pub");
  fs.writeFileSync(pubOnly, `${k.pub}\n`);
  const { sock, pid } = agentWith(k.priv);
  const saved = process.env.SSH_AUTH_SOCK;
  try {
    process.env.SSH_AUTH_SOCK = sock;
    for (const signingKey of [pubOnly, `key::${k.pub}`]) {
      git(dest, "config", "user.signingkey", signingKey);
      const sig = sshSignWithGitKey(dest, "message for the note", NAMESPACE);
      assert.ok(sig, `${signingKey}: signed through the agent`);
      assert.ok(verifies(k.pub, "message for the note", sig), `${signingKey}: verifies`);
      assert.equal(verifies(k.pub, "another message", sig), false, `${signingKey}: bound to the message`);
    }
    // Without the agent neither form can sign: null, and break-glass refuses (BYPASS_SIGNING_UNAVAILABLE).
    delete process.env.SSH_AUTH_SOCK;
    assert.equal(sshSignWithGitKey(dest, "m", NAMESPACE), null);
  } finally {
    if (saved === undefined) delete process.env.SSH_AUTH_SOCK;
    else process.env.SSH_AUTH_SOCK = saved;
    spawnSync("kill", [pid]);
  }
});

test("bypass note: this repository's msn_commits job judges the range with a gantry built from the PR base, not the head", () => {
  type Step = { uses?: string; with?: Record<string, unknown>; run?: string; "working-directory"?: string };
  const wf = YAML.parse(fs.readFileSync(path.join(OG, ".github", "workflows", "gxt-validate.yml"), "utf8")) as { jobs: Record<string, { steps: Step[] }> };
  const steps = wf.jobs.msn_commits!.steps;
  const base = steps.find((s) => s.uses?.startsWith("actions/checkout@") && s.with?.ref === "${{ github.event.pull_request.base.sha }}");
  assert.ok(base, "a checkout of base.sha");
  const dir = String(base.with!.path);
  assert.ok(dir && dir !== "." && !dir.includes(".."), "into its own directory");
  assert.ok(steps.some((s) => s["working-directory"] === dir && /npm ci/.test(s.run ?? "") && /npm run build/.test(s.run ?? "")), "built there");
  const runs = steps.map((s) => s.run ?? "").filter((r) => /ci msn-range/.test(r));
  assert.equal(runs.length, 1);
  assert.match(runs[0]!, new RegExp(`^node ${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/dist/cli/index\\.js ci msn-range `));
  assert.equal(steps.some((s) => !s["working-directory"] && /npm (ci|run build)/.test(s.run ?? "")), false, "the PR head is never built in this job");
});
