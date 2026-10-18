import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getRepoRoot, gitChildEnv } from "../lib/git/git.js";
import { checkVerifyResult, runVerifyContract } from "../lib/verify-standalone/run.js";

const CLI = path.join(getRepoRoot(), "dist", "cli", "index.js");
const HAS_SSH_KEYGEN = spawnSync("ssh-keygen", ["-?"], { encoding: "utf8" }).error === undefined;
const NEEDS_SSH = { skip: HAS_SSH_KEYGEN ? false : "ssh-keygen not available" };

function git(dest: string, ...args: string[]): string {
  const r = spawnSync(
    "git",
    ["-C", dest, "-c", "user.email=fixture@example.com", "-c", "user.name=Fixture", "-c", "commit.gpgsign=false", ...args],
    { encoding: "utf8", env: gitChildEnv() },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function keypair(dir: string, name: string): { key: string; pub: string } {
  const key = path.join(dir, name);
  const r = spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", name, "-f", key], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return { key, pub: fs.readFileSync(`${key}.pub`, "utf8").trim() };
}

/** A repo with one committed change, signing configured with a throwaway SSH key, and a team allowed-signers file. */
function makeRepo(prefix: string): { dest: string; base: string; signers: string; keys: string } {
  const dest = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const keys = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-keys-"));
  git(dest, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dest, "verify.yaml"), "schema: opengantry.verify.v1\nchecks: [{ name: ok, run: 'true', expect: exit0 }]\n");
  git(dest, "add", "-A");
  git(dest, "commit", "-q", "-m", "base");
  const base = git(dest, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(dest, "a.txt"), "a\n");
  git(dest, "add", "-A");
  git(dest, "commit", "-q", "-m", "work");
  const ci = keypair(keys, "ci");
  git(dest, "config", "gpg.format", "ssh");
  git(dest, "config", "user.signingkey", `${ci.key}.pub`);
  const signers = path.join(keys, "allowed_signers");
  fs.writeFileSync(signers, `ci@example.com ${ci.pub}\n`);
  return { dest, base, signers, keys };
}

function save(file: string, value: unknown): void {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

test("verify --sign: the result carries the receipt-signing envelope and verifies against an allowed-signers file (MSN-0279 DoD 7, 8)", NEEDS_SSH, () => {
  const { dest, base, signers, keys } = makeRepo("og-verify-sign-");
  const r = runVerifyContract({ cwd: dest, base, sign: true });
  assert.equal(r.status, "pass");
  assert.deepEqual(Object.keys(r.signature ?? {}).sort(), ["key_fingerprint", "kind", "payload_encoding", "signature_b64", "verify_status"]);
  assert.equal(r.signature?.kind, "ssh");
  assert.equal(r.signature?.payload_encoding, "canonical_json_utf8");
  assert.match(r.signature?.key_fingerprint ?? "", /^SHA256:/);

  const out = path.join(keys, "result.json");
  save(out, r);
  assert.deepEqual(checkVerifyResult(out, { cwd: dest, base, allowedSigners: signers }), { ok: true, problems: [], signer: "ci@example.com" });

  save(out, { ...r, size: { ...r.size, added: 0 } });
  assert.match(checkVerifyResult(out, { cwd: dest, base, allowedSigners: signers }).problems.join(), /the signature does not verify against .* \(bad\)/, "tampered result");

  const other = keypair(keys, "other");
  const otherSigners = path.join(keys, "other_signers");
  fs.writeFileSync(otherSigners, `someone@example.com ${other.pub}\n`);
  save(out, r);
  assert.match(checkVerifyResult(out, { cwd: dest, base, allowedSigners: otherSigners }).problems.join(), /does not verify/, "a key not on the list");

  const { signature: _drop, ...unsigned } = r;
  save(out, unsigned);
  assert.deepEqual(checkVerifyResult(out, { cwd: dest, base, allowedSigners: signers }).problems, ["the result is not signed"]);
  assert.equal(checkVerifyResult(out, { cwd: dest, base }).ok, true, "without --allowed-signers a signature is not required");
});

test("verify --sign: no signing key fails closed; flag misuse exits 2; the CLI signs and verifies end to end (MSN-0279 DoD 7)", NEEDS_SSH, () => {
  const { dest, base, signers, keys } = makeRepo("og-verify-sign-cli-");
  const run = (...args: string[]) => spawnSync(process.execPath, [CLI, "verify", ...args], { cwd: dest, encoding: "utf8", env: gitChildEnv() });

  const out = path.join(keys, "r.json");
  const signed = run("--contract", "--base", base, "--out", out, "--sign");
  assert.equal(signed.status, 0, signed.stderr);
  assert.match(signed.stderr, /^verify: signed \(ssh SHA256:/m);
  const ok = run("--contract", "--base", base, "--check-result", out, "--allowed-signers", signers);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stderr, /^verify: VERIFIED, signed by ci@example\.com$/m);

  assert.equal(run("--contract", "--base", base, "--sign").status, 2, "--sign needs --out");
  assert.equal(run("--contract", "--base", base, "--allowed-signers", signers).status, 2, "--allowed-signers needs --check-result");

  git(dest, "config", "--unset", "user.signingkey");
  const nokey = run("--contract", "--base", base, "--out", out, "--sign");
  assert.equal(nokey.status, 2);
  assert.match(nokey.stderr, /GXT_VERIFY_SIGN_NO_KEY/);
});
