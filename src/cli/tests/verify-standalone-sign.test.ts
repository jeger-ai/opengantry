import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getRepoRoot, gitChildEnv } from "#git/git.js";
import type { Bundle } from "sigstore";
import { checkKeylessSignature, GITHUB_ACTIONS_ISSUER, signVerifyResultKeyless, type SigstoreApi } from "#verify/keyless.js";
import { checkVerifyResult, runVerifyContract } from "#verify/run.js";

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
  const { ok, problems, signer } = checkVerifyResult(out, { cwd: dest, base, allowedSigners: signers });
  assert.deepEqual({ ok, problems, signer }, { ok: true, problems: [], signer: "ci@example.com" });

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

/** A stand-in for sigstore: the "bundle" carries the payload it signed, verify compares it and the requested identity. */
function fakeSigstore(identity: string): SigstoreApi & { signed: Buffer[] } {
  const signed: Buffer[] = [];
  return {
    signed,
    sign(payload) {
      signed.push(payload);
      return Promise.resolve({ fake: payload.toString("base64"), verificationMaterial: { tlogEntries: [{ logIndex: "42" }] } } as unknown as Bundle);
    },
    verify(bundle, payload, options) {
      if ((bundle as unknown as { fake: string }).fake !== payload.toString("base64")) return Promise.reject(new Error("signature mismatch"));
      if (!new RegExp(options.certificateIdentityURI ?? options.certificateIdentityEmail ?? "").test(identity)) return Promise.reject(new Error("identity mismatch"));
      if (options.certificateIssuer !== GITHUB_ACTIONS_ISSUER) return Promise.reject(new Error("issuer mismatch"));
      return Promise.resolve({ identity: { subjectAlternativeName: identity } });
    },
  };
}

test("verify --sign keyless: a Sigstore bundle over the canonical result; --certificate-identity checks identity and payload (MSN-0341)", NEEDS_SSH, async () => {
  const { dest, base, keys } = makeRepo("og-verify-keyless-");
  const workflow = "https://github.com/acme/app/.github/workflows/ci.yml@refs/heads/main";
  const sigstore = fakeSigstore(workflow);
  const r = await signVerifyResultKeyless(runVerifyContract({ cwd: dest, base }), sigstore, { SIGSTORE_ID_TOKEN: "token" });
  assert.equal(r.signature?.kind, "sigstore");
  assert.equal(r.signature?.payload_encoding, "canonical_json_utf8");
  assert.equal(sigstore.signed.length, 1);
  assert.ok(!sigstore.signed[0]!.toString("utf8").includes('"signature"'), "the signature is not part of the signed payload");

  const out = path.join(keys, "keyless.json");
  save(out, r);
  const checked = checkVerifyResult(out, { cwd: dest, base });
  assert.equal(checked.ok, true);
  const check = { identity: "^https://github\\.com/acme/app/", issuer: GITHUB_ACTIONS_ISSUER };
  assert.deepEqual(await checkKeylessSignature(checked.result, check, sigstore), { problem: null, signer: workflow });
  assert.match((await checkKeylessSignature({ ...checked.result, size: { added: 0, max: null, files: 0 } }, check, sigstore)).problem ?? "", /does not verify for .* \(signature mismatch\)/, "tampered result");
  assert.match((await checkKeylessSignature(checked.result, { ...check, identity: "^https://github\\.com/evil/" }, sigstore)).problem ?? "", /identity mismatch/);
  assert.deepEqual(checkVerifyResult(out, { cwd: dest, base, allowedSigners: path.join(keys, "allowed_signers") }).problems, ["the result is signed keyless (Sigstore): check it with --certificate-identity"]);
  const { signature: _drop, ...unsigned } = r;
  assert.equal((await checkKeylessSignature(unsigned, check, sigstore)).problem, "the result is not signed");
});

test("verify --sign keyless: no OIDC identity fails closed with exit 2 before any network call; flag misuse exits 2 (MSN-0341)", NEEDS_SSH, async () => {
  const { dest, base, keys } = makeRepo("og-verify-keyless-cli-");
  await assert.rejects(signVerifyResultKeyless(runVerifyContract({ cwd: dest, base }), fakeSigstore("x"), {}), (e: Error & { code?: string }) => e.code === "GXT_VERIFY_SIGN_NO_IDENTITY");
  const env = { ...gitChildEnv() };
  for (const name of ["SIGSTORE_ID_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL", "ACTIONS_ID_TOKEN_REQUEST_TOKEN"]) delete env[name];
  const run = (...args: string[]) => spawnSync(process.execPath, [CLI, "verify", ...args], { cwd: dest, encoding: "utf8", env });
  const out = path.join(keys, "r.json");
  const noIdentity = run("--contract", "--base", base, "--out", out, "--sign", "keyless");
  assert.equal(noIdentity.status, 2, noIdentity.stderr);
  assert.match(noIdentity.stderr, /GXT_VERIFY_SIGN_NO_IDENTITY/);
  assert.ok(!fs.existsSync(out), "nothing is written when signing cannot run");
  const usage: [string[], RegExp][] = [
    [["--out", out, "--sign", "gpg"], /--sign takes no value or keyless \(got gpg\)/],
    [["--certificate-identity", "x"], /--certificate-identity is for --check-result/],
    [["--check-result", out, "--certificate-oidc-issuer", "https://x"], /--certificate-oidc-issuer goes with --certificate-identity/],
    [["--check-result", out, "--certificate-identity", "x", "--allowed-signers", "f"], /use --allowed-signers or --certificate-identity/],
  ];
  for (const [args, pattern] of usage) {
    const r = run("--contract", "--base", base, ...args);
    assert.equal(r.status, 2, `${args.join(" ")}: ${r.stderr}`);
    assert.match(r.stderr, pattern);
  }
});
