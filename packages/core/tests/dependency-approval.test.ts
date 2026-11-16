import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APPROVAL_SIGNATURE_NAMESPACE,
  DependencyApprovalError,
  approvalSignedMessage,
  parseAllowedSigners,
  parseDependencyApproval,
  parseDependencyRevocation,
  sshSignatureSignedData,
  verifyDependencyApproval,
  verifySshSignature,
} from "../src/dependency-approval.js";

// --- SSHSIG fixture signer (the same wire format `ssh-keygen -Y sign` writes) ---

function sshString(b: Buffer | string): Buffer {
  const body = typeof b === "string" ? Buffer.from(b) : b;
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  return Buffer.concat([len, body]);
}

interface Key {
  priv: KeyObject;
  blob: Buffer;
  line: (principal: string, options?: string) => string;
}

function newKey(): Key {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
  const blob = Buffer.concat([sshString("ssh-ed25519"), sshString(raw)]);
  return { priv: privateKey, blob, line: (p, o) => `${p} ${o ? `${o} ` : ""}ssh-ed25519 ${blob.toString("base64")} comment` };
}

function sshsig(key: Key, message: string, namespace = APPROVAL_SIGNATURE_NAMESPACE, hash: "sha512" | "sha256" = "sha512"): string {
  const sig = sign(null, sshSignatureSignedData(message, namespace, hash), key.priv);
  const blob = Buffer.concat([
    Buffer.from("SSHSIG"),
    Buffer.from([0, 0, 0, 1]),
    sshString(key.blob),
    sshString(namespace),
    sshString(""),
    sshString(hash),
    sshString(Buffer.concat([sshString("ssh-ed25519"), sshString(sig)])),
  ]);
  const b64 = blob.toString("base64").replace(/.{1,70}/g, "$&\n");
  return `-----BEGIN SSH SIGNATURE-----\n${b64}-----END SSH SIGNATURE-----\n`;
}

const DIGEST = "a".repeat(64);
const REG = "https://registry.npmjs.org/";

function body(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "opengantry.dependency-approval.v1",
    lockfile: "package-lock.json",
    graph_digest: DIGEST,
    policy_revision: "b".repeat(64),
    identities: [{ name: "left-pad", version: "1.3.0", source: { kind: "registry", ref: REG }, integrity: "sha512-x" }],
    lifecycle: [],
    root_scripts: [],
    files: [],
    approver: "planner@example.com",
    issued_at: "2026-11-16T00:00:00Z",
    expires_at: "2027-11-16T00:00:00Z",
    ...extra,
  };
}

function signed(key: Key, extra: Record<string, unknown> = {}): string {
  const b = body(extra);
  return JSON.stringify({ ...b, signature: sshsig(key, approvalSignedMessage(b)) });
}

function refused(text: string, detail: RegExp): void {
  assert.throws(() => parseDependencyApproval(text), (e: unknown) => e instanceof DependencyApprovalError && detail.test(e.message));
}

test("dependency approval: a signed approval parses and its id is the sha256 of the signed body (MSN-0382)", () => {
  const key = newKey();
  const text = signed(key);
  const a = parseDependencyApproval(text);
  assert.equal(a.lockfile, "package-lock.json");
  assert.equal(a.graphDigest, DIGEST);
  assert.deepEqual(a.identities, [{ name: "left-pad", version: "1.3.0", source: { kind: "registry", ref: REG }, integrity: "sha512-x" }]);
  assert.equal(a.approver, "planner@example.com");
  assert.equal(a.id, createHash("sha256").update(approvalSignedMessage(body())).digest("hex"));
  const reordered = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(text) as Record<string, unknown>).reverse()));
  assert.equal(parseDependencyApproval(reordered).id, a.id, "key order does not change the id");
});

test("dependency approval: the format is closed; malformed, unknown and loose fields are refused (MSN-0382)", () => {
  const key = newKey();
  refused("{", /not JSON/);
  refused("[]", /must be a JSON object/);
  refused(signed(key, { extra: 1 }), /unknown key "extra"/);
  refused(signed(key, { schema: "opengantry.dependency-approval.v2" }), /schema must be opengantry\.dependency-approval\.v1/);
  refused(signed(key, { graph_digest: "x" }), /graph_digest must be a sha256/);
  refused(signed(key, { policy_revision: undefined }), /policy_revision must be a sha256/);
  refused(signed(key, { lockfile: "../package-lock.json" }), /lockfile must be a repository-relative path/);
  refused(signed(key, { lockfile: "yarn.lock" }), /lockfile must name a package-lock\.json or npm-shrinkwrap\.json/);
  refused(signed(key, { identities: [{ name: "a", version: "1.0.0", source: { kind: "git", ref: "git+https://x" }, integrity: null }] }), /identities\[0\]\.source\.kind must be registry/);
  refused(signed(key, { identities: [{ name: "a", version: "1.0.0", source: { kind: "registry", ref: REG }, integrity: null }] }), /identities\[0\]\.integrity is required/);
  refused(signed(key, { identities: [{ name: "a", version: "1.0.0", source: { kind: "registry", ref: "https://u:p@r.example/" }, integrity: "sha512-x" }] }), /credentials/);
  refused(signed(key, { identities: [{ name: "a", source: { kind: "registry", ref: REG }, integrity: "sha512-x" }] }), /identities\[0\]\.version/);
  refused(signed(key, { lifecycle: [{ name: "a", version: "1.0.0", source: { kind: "registry", ref: REG }, integrity: "sha512-x", scripts: ["prepare"] }] }), /scripts/);
  refused(signed(key, { lifecycle: [{ name: "a", version: "1.0.0", source: { kind: "registry", ref: REG }, integrity: "sha512-x", scripts: [] }] }), /scripts/);
  refused(signed(key, { root_scripts: [{ script: "test", command_sha256: DIGEST }] }), /root_scripts\[0\]\.script/);
  refused(signed(key, { files: [{ path: "/etc", content_digest: DIGEST }] }), /files\[0\]\.path/);
  refused(signed(key, { files: [{ path: "vendor/x", content_digest: "nope" }] }), /files\[0\]\.content_digest/);
  refused(signed(key, { approver: "" }), /approver/);
  refused(signed(key, { expires_at: "next year" }), /expires_at must be a UTC timestamp/);
  refused(signed(key, { expires_at: "2026-11-15T00:00:00Z" }), /expires_at must be after issued_at/);
  refused(JSON.stringify(body()), /signature is required/);
  refused(signed(key, { identities: Array.from({ length: 10_001 }, (_, i) => ({ name: `p${String(i)}`, version: "1.0.0", source: { kind: "registry", ref: REG }, integrity: "sha512-x" })) }), /identities has more than 10000 entries/);
  refused(" ".repeat(4 * 1024 * 1024 + 1), /larger than/);
});

test("dependency approval: a signature by an allowlisted key for the approver verifies (MSN-0382)", () => {
  const key = newKey();
  const signers = parseAllowedSigners(`# Planner\n${key.line("planner@example.com")}\n`);
  assert.deepEqual(verifyDependencyApproval(parseDependencyApproval(signed(key)), signers), { status: "good", principal: "planner@example.com" });
});

test("dependency approval: forgeries do not verify (MSN-0382)", () => {
  const planner = newKey();
  const attacker = newKey();
  const signers = parseAllowedSigners(planner.line("planner@example.com"));
  const bad = (text: string, why: RegExp) => {
    const v = verifyDependencyApproval(parseDependencyApproval(text), signers);
    assert.equal(v.status, "bad");
    if (v.status === "bad") assert.match(v.detail, why);
  };
  bad(signed(attacker), /not in the allowed signers/);
  // The planner signed one body; the candidate swaps a field after signing.
  const original = JSON.parse(signed(planner)) as Record<string, unknown>;
  bad(JSON.stringify({ ...original, identities: [{ name: "evil", version: "1.0.0", source: { kind: "registry", ref: REG }, integrity: "sha512-e" }] }), /signature does not verify/);
  // A valid signature for another principal's line does not let the approval name the planner.
  const both = parseAllowedSigners(`${planner.line("planner@example.com")}\n${attacker.line("someone@example.com")}`);
  const v = verifyDependencyApproval(parseDependencyApproval(signed(attacker)), both);
  assert.equal(v.status, "bad", "the key must be listed for the approver named in the approval");
  // The right key, but signed for another namespace (a verify receipt signature, namespace gxt).
  const b = body();
  bad(JSON.stringify({ ...b, signature: sshsig(planner, approvalSignedMessage(b), "gxt") }), /namespace/);
  bad(JSON.stringify({ ...b, signature: "-----BEGIN SSH SIGNATURE-----\nAAAA\n-----END SSH SIGNATURE-----\n" }), /malformed/);
  bad(JSON.stringify({ ...b, signature: "not armored" }), /malformed/);
});

test("dependency approval: allowed signers are read fail-closed (MSN-0382)", () => {
  const key = newKey();
  const text = signed(key);
  const good = (line: string) => verifyDependencyApproval(parseDependencyApproval(text), parseAllowedSigners(line)).status;
  assert.equal(good(key.line("planner@example.com")), "good");
  assert.equal(good(key.line("other@example.com,planner@example.com")), "good", "a principal list");
  assert.equal(good(key.line("planner@example.com", `namespaces="${APPROVAL_SIGNATURE_NAMESPACE}"`)), "good", "restricted to our namespace");
  assert.equal(good(key.line("planner@example.com", 'namespaces="git"')), "bad", "restricted to another namespace");
  assert.equal(good(key.line("planner@example.com", "cert-authority")), "bad", "certificate authorities are not trusted");
  assert.equal(good(key.line("planner@example.com", 'valid-before="20300101"')), "bad", "unknown options make the line untrusted");
  assert.equal(good(key.line("*@example.com")), "bad", "wildcard principals are not trusted");
  assert.equal(good(`planner@example.com ssh-rsa ${key.blob.toString("base64")}`), "bad", "only ssh-ed25519 keys");
  assert.equal(good(""), "bad");
  assert.equal(parseAllowedSigners("x".repeat(64 * 1024 + 1)).length, 0, "an oversized allowed-signers file trusts nobody");
});

test("dependency approval: real ssh-keygen -Y sign output verifies; a gxt receipt signature does not (MSN-0382)", { skip: spawnSync("ssh-keygen", ["-?"]).error ? "ssh-keygen not available" : false }, () => {
  const dir = mkdtempSync(join(tmpdir(), "gxt-sshsig-"));
  try {
    const keyPath = join(dir, "id");
    assert.equal(spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "planner", "-f", keyPath]).status, 0);
    const pub = readFileSync(`${keyPath}.pub`, "utf8").trim().split(/\s+/);
    const signers = parseAllowedSigners(`planner@example.com ${pub[0]!} ${pub[1]!}`);
    const b = body();
    const msgPath = join(dir, "approval.json");
    writeFileSync(msgPath, approvalSignedMessage(b));
    const sigFor = (ns: string) => {
      assert.equal(spawnSync("ssh-keygen", ["-Y", "sign", "-f", keyPath, "-n", ns, msgPath]).status, 0);
      const s = readFileSync(`${msgPath}.sig`, "utf8");
      rmSync(`${msgPath}.sig`);
      return s;
    };
    const ok = verifyDependencyApproval(parseDependencyApproval(JSON.stringify({ ...b, signature: sigFor(APPROVAL_SIGNATURE_NAMESPACE) })), signers);
    assert.deepEqual(ok, { status: "good", principal: "planner@example.com" });
    const receipt = verifyDependencyApproval(parseDependencyApproval(JSON.stringify({ ...b, signature: sigFor("gxt") })), signers);
    assert.equal(receipt.status, "bad");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dependency approval: sshsig verification checks the message, not only the key (MSN-0382)", () => {
  const key = newKey();
  const signers = parseAllowedSigners(key.line("p"));
  const armored = sshsig(key, "hello", "ns", "sha256");
  assert.deepEqual(verifySshSignature("hello", armored, "ns", signers), { status: "good", principals: ["p"] });
  assert.equal(verifySshSignature("hello!", armored, "ns", signers).status, "bad");
});

test("dependency approval: a revocation names approval ids and is closed (MSN-0382)", () => {
  const r = parseDependencyRevocation(
    JSON.stringify({ schema: "opengantry.dependency-revocation.v1", revokes: [DIGEST], reason: "compromised", revoked_by: "planner@example.com", issued_at: "2026-11-16T00:00:00Z" }),
  );
  assert.deepEqual(r.revokes, [DIGEST]);
  assert.throws(() => parseDependencyRevocation(JSON.stringify({ schema: "opengantry.dependency-revocation.v1", revokes: ["x"], reason: "r", revoked_by: "p", issued_at: "2026-11-16T00:00:00Z" })), /revokes/);
  assert.throws(() => parseDependencyRevocation(JSON.stringify({ schema: "opengantry.dependency-revocation.v1", revokes: [DIGEST], reason: "r", revoked_by: "p", issued_at: "2026-11-16T00:00:00Z", extra: 1 })), /unknown key "extra"/);
});
