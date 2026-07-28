#!/usr/bin/env node
/**
 * Generate cross-repo hub receipt v0.2.0 golden fixtures for opengantry-plane verification.
 * Run: node scripts/gen-hub-receipt-fixtures.mjs
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "test", "fixtures", "hub-receipts-v0.2.0");
const FIXTURE_ORG = {
  org_id: "org-golden-fixture",
  pepper: "golden-pepper-do-not-use-in-production",
  pepper_version: 1,
};

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

function hmac(pepper, msg) {
  return crypto.createHmac("sha256", pepper).update(msg, "utf8").digest("hex");
}

function baseReceipt(overrides = {}) {
  const body = {
    schema_version: "0.2.0",
    org_id: FIXTURE_ORG.org_id,
    pepper_version: FIXTURE_ORG.pepper_version,
    repository_hash: hmac(FIXTURE_ORG.pepper, "https://github.com/example/golden-repo.git"),
    branch_hmac: hmac(FIXTURE_ORG.pepper, "main"),
    branch_class: "default",
    msn_id: "MSN-9999",
    mission_sha256: "a".repeat(64),
    manifest_sha256: "b".repeat(64),
    target_architecture_sha256: "c".repeat(64),
    config_sha256: "d".repeat(64),
    git_head: "e".repeat(40),
    git_tree_sha: "f".repeat(40),
    agent: { name: "fixture-generator", version: "0.0.0", harness_mode: "cli" },
    planner_stamp: null,
    signer_principal_hmac: hmac(FIXTURE_ORG.pepper, "signer@example.com"),
    signer_principal_kind: "email",
    verify_status: "passed",
    issued_at: "2026-07-28T12:00:00.000Z",
    ...overrides,
  };
  const unsigned = { ...body };
  const receipt_sha256 = crypto
    .createHash("sha256")
    .update(canonicalJson(unsigned), "utf8")
    .digest("hex");
  return { ...unsigned, receipt_sha256 };
}

function envelopeFromReceipt(receipt, signature) {
  const canonicalUtf8 = canonicalJson(
    Object.fromEntries(Object.entries(receipt).filter(([k]) => k !== "signature")),
  );
  return {
    envelope_schema_version: "1.0.0",
    payload_b64: Buffer.from(canonicalUtf8, "utf8").toString("base64"),
    ...(signature ? { signature } : {}),
  };
}

function sshFingerprint(pubPath) {
  const fp = spawnSync("ssh-keygen", ["-l", "-f", pubPath], { encoding: "utf8" });
  const match = /SHA256:([A-Za-z0-9+/=]+)/.exec(fp.stdout ?? "");
  return match ? `SHA256:${match[1]}` : "unknown";
}

function generateSSHFixture(name, keygenArgs) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `gxt-golden-${name}-`));
  const keyPath = path.join(tmp, name);
  execSync(`ssh-keygen ${keygenArgs} -f ${keyPath} -N "" -C signer@example.com`, { stdio: "pipe" });
  const receipt = baseReceipt();
  const canonicalUtf8 = canonicalJson(receipt);
  const msgPath = path.join(tmp, "msg.txt");
  const sigPath = `${msgPath}.sig`;
  fs.writeFileSync(msgPath, canonicalUtf8, "utf8");
  execSync(`ssh-keygen -Y sign -f ${keyPath} -n gxt ${msgPath}`, { stdio: "pipe" });
  const signature = {
    kind: "ssh",
    signature_b64: fs.readFileSync(sigPath).toString("base64"),
    payload_encoding: "canonical_json_utf8",
    key_fingerprint: sshFingerprint(`${keyPath}.pub`),
    verify_status: "unknown",
  };
  return {
    envelope: envelopeFromReceipt({ ...receipt, signature }, signature),
    public_key: fs.readFileSync(`${keyPath}.pub`, "utf8").trim(),
  };
}

function generateGPGFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gxt-golden-gpg-"));
  const gpgHome = path.join(tmp, "gnupg");
  fs.mkdirSync(gpgHome, { mode: 0o700 });
  const env = { ...process.env, GNUPGHOME: gpgHome };
  const uid = "Fixture Signer <signer@example.com>";
  execSync(
    `gpg --batch --pinentry-mode loopback --passphrase '' --quick-generate-key "${uid}" ed25519 sign 0`,
    { stdio: "pipe", env },
  );
  const receipt = baseReceipt();
  const canonicalUtf8 = canonicalJson(receipt);
  const msgPath = path.join(tmp, "msg.txt");
  const sigPath = path.join(tmp, "msg.sig.asc");
  fs.writeFileSync(msgPath, canonicalUtf8, "utf8");
  execSync(
    `gpg --batch --armor --detach-sign --local-user "${uid}" -o "${sigPath}" "${msgPath}"`,
    { stdio: "pipe", env },
  );
  const fprOut = execSync(`gpg --fingerprint --with-colons "${uid}"`, { encoding: "utf8", env });
  const fprLine = fprOut.split("\n").find((l) => l.startsWith("fpr:"));
  const fingerprint = fprLine ? fprLine.split(":")[9] : "unknown";
  const pubPath = path.join(tmp, "pub.asc");
  execSync(`gpg --armor --export "${uid}" > "${pubPath}"`, { stdio: "pipe", env, shell: true });
  const signature = {
    kind: "gpg",
    signature_b64: fs.readFileSync(sigPath).toString("base64"),
    payload_encoding: "canonical_json_utf8",
    key_fingerprint: fingerprint,
    verify_status: "unknown",
  };
  return {
    envelope: envelopeFromReceipt({ ...receipt, signature }, signature),
    public_key: fs.readFileSync(pubPath, "utf8").trim(),
  };
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const unsignedReceipt = baseReceipt();
fs.writeFileSync(
  path.join(OUT_DIR, "unsigned.envelope.json"),
  `${JSON.stringify(envelopeFromReceipt(unsignedReceipt), null, 2)}\n`,
);

const tampered = envelopeFromReceipt(baseReceipt({ verify_status: "failed" }));
const good = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "unsigned.envelope.json"), "utf8"));
tampered.payload_b64 = good.payload_b64;
tampered.tamper_note = "verify_status in decoded payload does not match rebuilt receipt";
fs.writeFileSync(path.join(OUT_DIR, "tampered.envelope.json"), `${JSON.stringify(tampered, null, 2)}\n`);

const readme = [
  "# Hub receipt v0.2.0 golden fixtures",
  "",
  "Generated by `node scripts/gen-hub-receipt-fixtures.mjs`.",
  "",
  "- `unsigned.envelope.json` — valid payload, no signature",
  "- `tampered.envelope.json` — valid signature over modified payload (must reject)",
  "- `ed25519.envelope.json` + `ed25519.pub` — SSHSIG ed25519 over canonical bytes",
  "- `rsa4096.envelope.json` + `rsa4096.pub` — SSHSIG RSA over canonical bytes",
  "- `gpg.envelope.json` + `gpg.pub.asc` — OpenPGP detached signature over canonical bytes",
  "",
  "Org pepper for cross-rotation tests: see script constants (not committed in plaintext elsewhere).",
  "",
].join("\n");
fs.writeFileSync(path.join(OUT_DIR, "README.md"), `${readme}\n`);

for (const [name, args] of [
  ["ed25519", "-t ed25519"],
  ["rsa4096", "-t rsa -b 4096"],
]) {
  try {
    const ssh = generateSSHFixture(name, args);
    fs.writeFileSync(path.join(OUT_DIR, `${name}.envelope.json`), `${JSON.stringify(ssh.envelope, null, 2)}\n`);
    fs.writeFileSync(path.join(OUT_DIR, `${name}.pub`), `${ssh.public_key}\n`);
    console.log(`gen-hub-receipt-fixtures: wrote ${name} SSH fixture`);
  } catch (err) {
    console.warn(`gen-hub-receipt-fixtures: skipped ${name}`, err.message);
  }
}

try {
  const gpg = generateGPGFixture();
  fs.writeFileSync(path.join(OUT_DIR, "gpg.envelope.json"), `${JSON.stringify(gpg.envelope, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT_DIR, "gpg.pub.asc"), `${gpg.public_key}\n`);
  console.log("gen-hub-receipt-fixtures: wrote gpg fixture");
} catch (err) {
  console.warn("gen-hub-receipt-fixtures: skipped gpg", err.message);
}

console.log(`gen-hub-receipt-fixtures: wrote fixtures under ${OUT_DIR}`);
